/**
 * Repositorio de evidencias (media_assets + media_processing_jobs).
 *
 * Fase 4: registra metadatos y crea la tarea de procesamiento PENDING.
 * Los binarios NUNCA se guardan en PostgreSQL (viven en storage/ local con
 * clave opaca) y ninguna ruta los sirve (regla de seguridad 11).
 */
export function createMediaRepository({ db }) {
  /**
   * Conteo de evidencias activas por tipo para una denuncia.
   */
  async function countEvidenceByType(complaintId, client = null) {
    const runner = client ?? db;
    const { rows } = await runner.query(
      `SELECT media_type AS "mediaType", count(*)::int AS total
         FROM media_assets
        WHERE complaint_id = $1
          AND deleted_at IS NULL
        GROUP BY media_type`,
      [complaintId]
    );
    const counts = {};
    for (const row of rows) counts[row.mediaType] = row.total;
    return counts;
  }

  /**
   * Inserta el metadato del archivo y su tarea de procesamiento PENDING.
   * Debe ejecutarse dentro de la transaccion que bloquea la denuncia.
   * Soporta evidencia de denuncia (complaint_id) y de solucion (solution_id):
   * el CHECK de media_assets exige exactamente una de las dos.
   */
  async function insertEvidenceWithJob(
    client,
    {
      complaintId = null,
      solutionId = null,
      mediaType,
      storageKey,
      mimeType,
      sizeBytes,
      createdByUserId,
    }
  ) {
    const purpose = complaintId ? 'COMPLAINT_EVIDENCE' : 'SOLUTION_EVIDENCE';
    const { rows: assetRows } = await client.query(
      `INSERT INTO media_assets (
         complaint_id, solution_id, media_type, purpose, storage_key, mime_type, size_bytes,
         processing_status, created_by_user_id
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         'PENDING', $8
       )
       RETURNING id,
                 media_type AS "mediaType",
                 mime_type AS "mimeType",
                 size_bytes::text::bigint AS "sizeBytesRaw",
                 processing_status AS "processingStatus"`,
      [complaintId, solutionId, mediaType, purpose, storageKey, mimeType, sizeBytes, createdByUserId]
    );

    await client.query(
      `INSERT INTO media_processing_jobs (media_asset_id, status)
       VALUES ($1, 'PENDING')
       RETURNING id`,
      [assetRows[0].id]
    );

    // pg devuelve BIGINT como string: normalizar a numero para el contrato JSON.
    assetRows[0].sizeBytes = Number(assetRows[0].sizeBytesRaw);
    delete assetRows[0].sizeBytesRaw;

    return assetRows[0];
  }

  /**
   * Metadatos visibles para el dueño. Sin storage keys ni URLs.
   */
  async function listEvidence(complaintId) {
    const { rows } = await db.query(
      `SELECT id,
              media_type AS "mediaType",
              mime_type AS "mimeType",
              size_bytes::text::bigint AS "sizeBytesRaw",
              processing_status AS "processingStatus"
         FROM media_assets
        WHERE complaint_id = $1
          AND deleted_at IS NULL
        ORDER BY created_at`,
      [complaintId]
    );
    // pg devuelve BIGINT como string: normalizar a numero.
    return rows.map((row) => {
      const { sizeBytesRaw, ...rest } = row;
      return { ...rest, sizeBytes: Number(sizeBytesRaw) };
    });
  }

  /**
   * Marca asset y tarea como FAILED si el archivo no pudo persistirse.
   */
  async function markEvidenceFailed(mediaAssetId) {
    await db.transaction(async (client) => {
      await client.query(
        `UPDATE media_assets SET processing_status = 'FAILED' WHERE id = $1`,
        [mediaAssetId]
      );
      await client.query(
        `UPDATE media_processing_jobs
            SET status = 'FAILED',
                last_error_code = 'STORAGE_UNAVAILABLE',
                finished_at = now()
          WHERE media_asset_id = $1`,
        [mediaAssetId]
      );
    });
  }

  /**
   * Metadatos de evidencias para un lote de denuncias (bandeja de moderacion).
   * Devuelve un mapa complaintId -> evidencias. Sin storage keys ni URLs.
   */
  async function listEvidenceByComplaintIds(complaintIds) {
    if (complaintIds.length === 0) return {};
    const { rows } = await db.query(
      `SELECT complaint_id AS "complaintId",
              id,
              media_type AS "mediaType",
              mime_type AS "mimeType",
              size_bytes::text::bigint AS "sizeBytesRaw",
              processing_status AS "processingStatus"
         FROM media_assets
        WHERE complaint_id = ANY($1::uuid[])
          AND deleted_at IS NULL
        ORDER BY created_at`,
      [complaintIds]
    );

    const map = {};
    for (const row of rows) {
      const list = map[row.complaintId] ?? [];
      const { complaintId, sizeBytesRaw, ...rest } = row;
      list.push({ ...rest, sizeBytes: Number(sizeBytesRaw) });
      map[complaintId] = list;
    }
    return map;
  }

  /**
   * Conteo de evidencias activas por tipo para una SOLUCION (Fase 6).
   */
  async function countSolutionEvidenceByType(solutionId, client = null) {
    const runner = client ?? db;
    const { rows } = await runner.query(
      `SELECT media_type AS "mediaType", count(*)::int AS total
         FROM media_assets
        WHERE solution_id = $1
          AND deleted_at IS NULL
        GROUP BY media_type`,
      [solutionId]
    );
    const counts = {};
    for (const row of rows) counts[row.mediaType] = row.total;
    return counts;
  }

  /**
   * Soft-delete de una evidencia individual: fija deleted_at para que las
   * consultas la excluyan. Solo dentro de la ventana de gracia (Fase 7 P2).
   */
  async function softDeleteEvidence(client, evidenceId) {
    const { rows } = await client.query(
      `UPDATE media_assets
          SET deleted_at = now()
        WHERE id = $1
          AND deleted_at IS NULL
       RETURNING id`,
      [evidenceId]
    )
    return rows.length > 0
  }

  return {
    countEvidenceByType,
    insertEvidenceWithJob,
    listEvidence,
    listEvidenceByComplaintIds,
    countSolutionEvidenceByType,
    markEvidenceFailed,
    softDeleteEvidence,
  };
}
