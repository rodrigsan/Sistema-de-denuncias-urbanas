import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { asyncHandler } from '../utils/async-handler.js';

/**
 * Controladores de autenticacion (Fase 2).
 *
 * Flujo: /google/login genera state + PKCE en cookie temporal; /google/callback
 * valida state en tiempo constante, intercambia el codigo con el verificador,
 * resuelve la identidad por `sub` (nunca por correo), crea al ciudadano en una
 * transaccion si es primer acceso, bloquea cuentas no activas y emite la
 * cookie de sesion. Los errores del navegador redirigen al frontend con un
 * reason generico; nunca se loguean tokens, correos ni cookies.
 */
export function createAuthController({
  config,
  google,
  sessionService,
  oauthStateService,
  usersRepository,
}) {
  function frontendCallbackUrl(status, reason) {
    const url = new URL('/auth/callback', config.FRONTEND_ORIGIN);
    url.searchParams.set('status', status);
    if (reason) url.searchParams.set('reason', reason);
    return url.toString();
  }

  /**
   * GET /api/v1/auth/google/login
   */
  const googleLogin = asyncHandler(async (req, res) => {
    if (!google.isConfigured()) {
      throw new AppError(
        503,
        'OAUTH_NOT_CONFIGURED',
        'La autenticacion con Google no esta configurada.'
      );
    }

    const transaction = oauthStateService.createTransaction();
    res.cookie(oauthStateService.cookieName, oauthStateService.serialize(transaction), {
      signed: true,
      ...oauthStateService.cookieOptions(),
    });

    const authorizationUrl = google.buildAuthorizationUrl({
      state: transaction.state,
      codeChallenge: google.computeCodeChallenge(transaction.codeVerifier),
    });
    res.redirect(302, authorizationUrl);
  });

  /**
   * GET /api/v1/auth/google/callback
   */
  const googleCallback = asyncHandler(async (req, res) => {
    const fail = (reason) => {
      oauthStateService.clear(res);
      res.redirect(302, frontendCallbackUrl('error', reason));
      return null;
    };

    if (req.query.error) return fail('google_error');

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const stateParam = typeof req.query.state === 'string' ? req.query.state : '';
    if (!code || !stateParam) return fail('missing_params');

    const transaction = oauthStateService.parse(
      req.signedCookies?.[oauthStateService.cookieName]
    );
    if (!transaction) return fail('state_invalid');
    if (!oauthStateService.stateMatches(transaction, stateParam)) return fail('state_invalid');

    let tokens;
    try {
      tokens = await google.exchangeCode({
        code,
        codeVerifier: transaction.codeVerifier,
      });
    } catch (error) {
      logger.error('El intercambio de codigo OAuth fallo.', { code: error?.code });
      return fail('token_exchange');
    }

    let profile;
    try {
      profile = await google.fetchProfile({ accessToken: tokens.accessToken });
    } catch (error) {
      logger.error('La obtencion del perfil de Google fallo.', { code: error?.code });
      return fail('profile_failed');
    }

    // Identidad por provider_subject (sub verificado por Google), nunca email.
    let account = await usersRepository.findByIdentity('google', profile.sub);
    if (!account) {
      try {
        await usersRepository.createCitizenWithIdentity({
          provider: 'google',
          providerSubject: profile.sub,
          email: profile.email,
          emailVerifiedAt: profile.emailVerified ? new Date() : null,
        });
      } catch (error) {
        // Carrera concurrente (UNIQUE provider+subject): reconsultar abajo.
        if (error.code !== '23505') {
          logger.error('La creacion del ciudadano fallo.', { code: error?.code });
          return fail('account_creation_failed');
        }
      }
      account = await usersRepository.findByIdentity('google', profile.sub);
      if (!account) return fail('account_creation_failed');
    }

    // Suspension de 168 h: si ya cumplio vigencia, se reactiva en el login.
    if (account.status === 'SUSPENDED') {
      const reactivated = await usersRepository.resolveExpiredSuspension(account.id);
      if (reactivated) {
        account = await usersRepository.findByIdentity('google', profile.sub);
        if (!account) return fail('account_creation_failed');
      }
    }

    if (account.status !== 'ACTIVE') {
      logger.warn('Se bloqueo el inicio de sesion de una cuenta no activa.');
      return fail('account_blocked');
    }

    if (profile.emailVerified) {
      await usersRepository.updateVerifiedEmailIfMissing({
        userId: account.id,
        email: profile.email,
      });
    }

    oauthStateService.clear(res);
    sessionService.issue(res, account.id);
    res.redirect(302, frontendCallbackUrl('success'));
    return null;
  });

  /**
   * GET /api/v1/auth/me
   */
  function me(req, res) {
    const user = req.user;
    res.status(200).json({
      id: user.id,
      userType: user.userType,
      alias: user.alias,
      requiresAlias: user.requiresAlias,
      roles: user.roles,
      adminLocked: user.userType === 'ADMIN' && user.roles.length === 0,
      suspended: Boolean(user.suspended),
    });
  }

  /**
   * POST /api/v1/auth/alias
   */
  const setAlias = asyncHandler(async (req, res) => {
    if (req.user.userType !== 'CITIZEN') {
      throw new AppError(403, 'FORBIDDEN', 'Solo un ciudadano puede establecer un alias.');
    }
    if (req.user.alias) {
      throw new AppError(409, 'ALIAS_ALREADY_SET', 'El alias ya fue establecido y no puede cambiarse.');
    }

    let profile;
    try {
      profile = await usersRepository.insertCitizenProfile({
        userId: req.user.id,
        alias: req.validatedBody.alias,
      });
    } catch (error) {
      // PK de citizen_profiles: el perfil ya existia (carrera de doble POST).
      if (error.code === '23505') {
        throw new AppError(
          409,
          'ALIAS_ALREADY_SET',
          'El alias ya fue establecido y no puede cambiarse.'
        );
      }
      throw error;
    }

    res.status(201).json({
      alias: profile.alias,
      administrativeCode: profile.administrative_code,
    });
  });

  /**
   * POST /api/v1/auth/logout
   */
  function logout(req, res) {
    sessionService.clear(res);
    res.status(204).end();
  }

  return { googleLogin, googleCallback, me, setAlias, logout };
}
