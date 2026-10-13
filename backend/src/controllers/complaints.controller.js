/**
 * Controladores de denuncias (Fase 4). Capa fina: HTTP -> servicio.
 * Toda la logica de negocio vive en complaints.service/grace.service y toda
 * la logica de acceso a datos en los repositorios.
 */
export function createComplaintsController({ complaintsService }) {
  async function createComplaint(req, res) {
    const complaint = await complaintsService.createComplaint(req.user, req.validatedBody);
    res.status(201).json(complaint);
  }

  async function getComplaint(req, res) {
    const complaint = await complaintsService.getComplaint(req.user, req.params.id);
    res.status(200).json(complaint);
  }

  async function updateComplaint(req, res) {
    const complaint = await complaintsService.updateComplaint(req.user, req.params.id, req.validatedBody);
    res.status(200).json(complaint);
  }

  async function startEditSession(req, res) {
    const complaint = await complaintsService.startEditSession(req.user, req.params.id);
    res.status(200).json(complaint);
  }

  async function cancelEditSession(req, res) {
    const complaint = await complaintsService.cancelEditSession(req.user, req.params.id);
    res.status(200).json(complaint);
  }

  async function deleteComplaint(req, res) {
    await complaintsService.deleteComplaint(req.user, req.params.id, req.validatedBody);
    res.status(204).end();
  }

  async function addEvidence(req, res) {
    const evidence = await complaintsService.addEvidence(req.user, req.params.id, req.evidenceFile);
    res.status(201).json(evidence);
  }

  async function deleteEvidence(req, res) {
    await complaintsService.deleteEvidence(req.user, req.params.id, req.params.evidenceId);
    res.status(204).end();
  }

  return {
    createComplaint,
    getComplaint,
    updateComplaint,
    startEditSession,
    cancelEditSession,
    deleteComplaint,
    addEvidence,
    deleteEvidence,
  };
}
