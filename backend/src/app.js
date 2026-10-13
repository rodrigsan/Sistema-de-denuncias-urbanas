import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { createHealthRouter } from './routes/health.routes.js';
import { createAuthRouter } from './routes/auth.routes.js';
import { createCategoriesRouter, createMunicipalUnitsRouter } from './routes/catalogs.routes.js';
import { createCitizensRouter } from './routes/citizens.routes.js';
import { createComplaintsRouter } from './routes/complaints.routes.js';
import { createModerationRouter } from './routes/moderation.routes.js';
import { createTechnicalRouter } from './routes/technical.routes.js';
import { createSessionService } from './services/session.service.js';
import { createOAuthStateService } from './services/oauth-state.service.js';
import { createGoogleOAuthService } from './services/google-oauth.service.js';
import { createUsersRepository } from './repositories/users.repository.js';
import { createCatalogsRepository } from './repositories/catalogs.repository.js';
import { createComplaintsRepository } from './repositories/complaints.repository.js';
import { createMediaRepository } from './repositories/media.repository.js';
import { createModerationRepository } from './repositories/moderation.repository.js';
import { createCitizenComplaintsRepository } from './repositories/citizen-complaints.repository.js';
import { createTechnicalRepository } from './repositories/technical.repository.js';
import { createGraceService } from './services/grace.service.js';
import { createPlusCodeService } from './services/plus-code.service.js';
import { createComplaintsService } from './services/complaints.service.js';
import { createModerationService } from './services/moderation.service.js';
import { createCitizenTrackingService } from './services/citizen-tracking.service.js';
import { createTechnicalService } from './services/technical.service.js';
import { createLoadSession } from './middlewares/load-session.js';
import { createCsrfOrigin } from './middlewares/csrf-origin.js';
import { createGeneralRateLimiter, createAuthRateLimiter } from './middlewares/rate-limit.js';
import { notFound } from './middlewares/not-found.js';
import { errorHandler } from './middlewares/error-handler.js';

/**
 * Construye la aplicacion Express. Las dependencias (db, servicios, cliente
 * HTTP de Google) se inyectan para que las pruebas puedan simular el flujo de
 * Google sin credenciales reales; en produccion se usan las implementaciones
 * reales.
 */
export function createApp({
  db,
  config = env,
  google,
  sessionService,
  oauthStateService,
  usersRepository,
  catalogsRepository,
  complaintsRepository,
  mediaRepository,
  moderationRepository,
  citizenComplaintsRepository,
  technicalRepository,
  graceService,
  plusCodeService,
  complaintsService,
  moderationService,
  citizenTrackingService,
  technicalService,
  http,
} = {}) {
  if (!db) {
    throw new Error('createApp requiere una instancia de base de datos.');
  }

  const session = sessionService ?? createSessionService({ config });
  const oauthState = oauthStateService ?? createOAuthStateService({ config });
  const usersRepo = usersRepository ?? createUsersRepository({ db });
  const catalogsRepo = catalogsRepository ?? createCatalogsRepository({ db });
  const complaintsRepo = complaintsRepository ?? createComplaintsRepository({ db });
  const mediaRepo = mediaRepository ?? createMediaRepository({ db });
  const graceSvc = graceService ?? createGraceService({ complaintsRepository: complaintsRepo });
  const plusCodeSvc = plusCodeService ?? createPlusCodeService({ config });
  const complaintsSvc =
    complaintsService ??
    createComplaintsService({
      complaintsRepository: complaintsRepo,
      mediaRepository: mediaRepo,
      graceService: graceSvc,
      plusCodeService: plusCodeSvc,
      config,
    });
  const googleService = google ?? createGoogleOAuthService({ config, http });
  const moderationRepo = moderationRepository ?? createModerationRepository({ db });
  const citizenComplaintsRepo = citizenComplaintsRepository ?? createCitizenComplaintsRepository({ db });
  const technicalRepo = technicalRepository ?? createTechnicalRepository({ db });
  const moderationSvc =
    moderationService ??
    createModerationService({
      complaintsRepository: complaintsRepo,
      moderationRepository: moderationRepo,
      mediaRepository: mediaRepo,
      config,
    });
  const citizenTrackingSvc =
    citizenTrackingService ??
    createCitizenTrackingService({ citizenComplaintsRepository: citizenComplaintsRepo });
  const technicalSvc =
    technicalService ??
    createTechnicalService({
      complaintsRepository: complaintsRepo,
      technicalRepository: technicalRepo,
      moderationRepository: moderationRepo,
      mediaRepository: mediaRepo,
      config,
    });

  const app = express();

  // No revelar la tecnologia del servidor.
  app.disable('x-powered-by');

  // CORS restringido al origen del frontend autorizado (nunca comodin en produccion).
  app.use(
    cors({
      origin: config.FRONTEND_ORIGIN || false,
      credentials: true,
    })
  );

  app.use(express.json({ limit: '1mb' }));

  // Cookies firmadas con SESSION_SECRET (sesion y transaccion OAuth).
  app.use(cookieParser(config.SESSION_SECRET));

  // Limite general de peticiones.
  app.use(createGeneralRateLimiter({ config }));

  // Carga la sesion firmada en req.session (si existe y es valida).
  app.use(createLoadSession({ sessionService: session }));

  const csrfOrigin = createCsrfOrigin({ config });

  app.use('/api/v1/health', createHealthRouter({ db }));
  app.use(
    '/api/v1/auth',
    createAuthRouter({
      config,
      google: googleService,
      sessionService: session,
      oauthStateService: oauthState,
      usersRepository: usersRepo,
      csrfOrigin,
      authRateLimiter: createAuthRateLimiter({ config }),
    })
  );

  app.use(
    '/api/v1/categories',
    createCategoriesRouter({ usersRepository: usersRepo, catalogsRepository: catalogsRepo })
  );
  app.use(
    '/api/v1/municipal-units',
    createMunicipalUnitsRouter({ usersRepository: usersRepo, catalogsRepository: catalogsRepo })
  );
  app.use(
    '/api/v1/citizens',
    createCitizensRouter({
      usersRepository: usersRepo,
      citizenTrackingService: citizenTrackingSvc,
    })
  );

  app.use(
    '/api/v1/complaints',
    createComplaintsRouter({
      usersRepository: usersRepo,
      complaintsService: complaintsSvc,
      config,
      csrfOrigin,
    })
  );

  app.use(
    '/api/v1/moderation',
    createModerationRouter({
      usersRepository: usersRepo,
      moderationService: moderationSvc,
      csrfOrigin,
    })
  );

  app.use(
    '/api/v1/technical',
    createTechnicalRouter({
      usersRepository: usersRepo,
      technicalService: technicalSvc,
      config,
      csrfOrigin,
    })
  );

  // 404 uniforme y luego el manejador central de errores.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
