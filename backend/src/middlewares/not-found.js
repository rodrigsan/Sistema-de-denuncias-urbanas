/**
 * Respuesta uniforme para rutas no encontradas. No revela la lista de rutas
 * existentes ni detalles internos.
 */
export function notFound(req, res) {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Recurso no encontrado.',
    },
  });
}
