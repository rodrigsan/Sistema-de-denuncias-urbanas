/**
 * Controladores de moderacion (Fase 5). Capa fina: HTTP -> servicio.
 * RBAC y validaciones se aplican en la cadena de middlewares del router.
 */
export function createModerationController({ moderationService }) {
  async function listInbox(req, res) {
    const result = await moderationService.listInbox(req.validatedQuery);
    res.status(200).json(result);
  }

  async function approve(req, res) {
    const complaint = await moderationService.approve(req.user, req.params.id, req.validatedBody);
    res.status(200).json(complaint);
  }

  async function reject(req, res) {
    const complaint = await moderationService.reject(req.user, req.params.id, req.validatedBody);
    res.status(200).json(complaint);
  }

  async function listDuplicateCandidates(req, res) {
    const result = await moderationService.listDuplicateCandidates(req.user, req.params.id);
    res.status(200).json(result);
  }

  async function proposeDuplicate(req, res) {
    const proposal = await moderationService.proposeDuplicate(
      req.user,
      req.params.id,
      req.validatedBody
    );
    res.status(201).json(proposal);
  }

  async function listProposals(req, res) {
    const result = await moderationService.listProposals(req.validatedQuery);
    res.status(200).json(result);
  }

  async function resolveProposal(req, res) {
    const result = await moderationService.resolveProposal(
      req.user,
      req.params.id,
      req.validatedBody
    );
    res.status(200).json(result);
  }

  async function createGroup(req, res) {
    const result = await moderationService.createGroup(req.user, req.validatedBody);
    res.status(201).json(result);
  }

  async function verifySolution(req, res) {
    const result = await moderationService.verifySolution(req.user, req.params.id, req.validatedBody);
    res.status(200).json(result);
  }

  async function createViolation(req, res) {
    const result = await moderationService.createViolation(req.user, req.validatedBody);
    res.status(201).json(result);
  }

  return {
    listInbox,
    approve,
    reject,
    listDuplicateCandidates,
    proposeDuplicate,
    listProposals,
    resolveProposal,
    createGroup,
    verifySolution,
    createViolation,
  };
}
