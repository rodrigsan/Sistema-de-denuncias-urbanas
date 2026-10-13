/**
 * Controladores del Enlace Tecnico/Supervisor (Fase 6). Capa fina.
 */
export function createTechnicalController({ technicalService }) {
  async function listAssignedComplaints(req, res) {
    const result = await technicalService.listAssignedComplaints(req.user, req.validatedQuery);
    res.status(200).json(result);
  }

  async function startProcess(req, res) {
    const complaint = await technicalService.startProcess(req.user, req.params.id);
    res.status(200).json(complaint);
  }

  async function submitSolution(req, res) {
    const solution = await technicalService.submitSolution(req.user, req.params.id, req.validatedBody);
    res.status(201).json(solution);
  }

  async function addSolutionEvidence(req, res) {
    const evidence = await technicalService.addSolutionEvidence(
      req.user,
      req.params.solutionId,
      req.evidenceFile
    );
    res.status(201).json(evidence);
  }

  return { listAssignedComplaints, startProcess, submitSolution, addSolutionEvidence };
}
