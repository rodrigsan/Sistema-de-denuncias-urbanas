import busboyFactory from 'busboy';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../utils/errors.js';

/**
 * Middleware de subida de evidencias (multipart/form-data, campo "file").
 *
 * Defensa en profundidad:
 * - Streaming a disco con limite duro (nunca se bufferiza el archivo completo
 *   en memoria ni se guardan binarios en PostgreSQL).
 * - El tipo MIME declarado por el cliente se verifica contra la lista de
 *   permitidos Y contra los magic bytes reales del archivo.
 * - El tamaño lo mide el servidor (bytes escritos), no el cliente.
 * - La duracion del video es un valor declarado: se valida como compuerta de
 *   entrada; el contenedor real lo verificara el worker de procesamiento.
 *
 * Exito: req.evidenceFile = { mediaType, mimeType, sizeBytes, extension,
 * declaredDurationSeconds, tempPath, persistTo(storageKey), dispose() }.
 */

const FTYP_OFFSET = 4;
const FTYP_BRAND_OFFSET = 8;
const BRAND_LENGTH = 4;

const HEIC_BRANDS = new Set([
  'heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'mv11',
]);
const MP4_BRANDS = new Set([
  'isom', 'iso2', 'mp41', 'mp42', 'avc1', 'dash', 'mmp4', 'mp71', 'msnv', 'ndas',
  'ndsc', 'ndsh', 'ndsm', 'ndsp', 'ndss', 'ndxc', 'ndxh', 'ndxm', 'ndxp', 'ndxs',
  'f4v ',
]);
const QUICKTIME_BRANDS = new Set(['qt  ', 'M4V ', 'M4A ', 'M4H ', 'M4P ']);

const IMAGE_SPECS = new Map([
  ['image/jpeg', { extension: '.jpg' }],
  ['image/png', { extension: '.png' }],
  ['image/heic', { extension: '.heic' }],
  ['image/heif', { extension: '.heif' }],
]);
const VIDEO_SPECS = new Map([
  ['video/mp4', { extension: '.mp4' }],
  ['video/quicktime', { extension: '.mov' }],
]);

const MAGIC_BUFFER_LENGTH = 16;

function bufferStartsWith(buffer, signature) {
  if (buffer.length < signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (buffer[i] !== signature[i]) return false;
  }
  return true;
}

function isFtypBrand(buffer, brands) {
  if (buffer.length < FTYP_BRAND_OFFSET + BRAND_LENGTH) return false;
  if (buffer.toString('ascii', FTYP_OFFSET, FTYP_BRAND_OFFSET) !== 'ftyp') return false;
  const brand = buffer.toString('ascii', FTYP_BRAND_OFFSET, FTYP_BRAND_OFFSET + BRAND_LENGTH);
  return brands.has(brand);
}

async function matchesMagicBytes(filePath, mimeType) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(MAGIC_BUFFER_LENGTH);
    const { bytesRead } = await handle.read(buffer, 0, MAGIC_BUFFER_LENGTH, 0);
    const head = buffer.subarray(0, bytesRead);

    switch (mimeType) {
      case 'image/jpeg':
        return bufferStartsWith(head, [0xff, 0xd8, 0xff]);
      case 'image/png':
        return bufferStartsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      case 'image/heic':
      case 'image/heif':
        return isFtypBrand(head, HEIC_BRANDS);
      case 'video/mp4':
        return isFtypBrand(head, MP4_BRANDS);
      case 'video/quicktime':
        return isFtypBrand(head, QUICKTIME_BRANDS) || isFtypBrand(head, MP4_BRANDS);
      default:
        return false;
    }
  } finally {
    await handle.close();
  }
}

export function createEvidenceUpload({ config }) {
  const storageDirectory = config.STORAGE_DIRECTORY;
  const tempDirectory = path.join(storageDirectory, 'tmp');
  const maxImageBytes = config.EVIDENCE_MAX_IMAGE_MB * 1024 * 1024;
  const maxVideoBytes = config.EVIDENCE_MAX_VIDEO_MB * 1024 * 1024;
  const hardFileLimitBytes = Math.max(maxImageBytes, maxVideoBytes);

  fs.mkdirSync(tempDirectory, { recursive: true });

  return function evidenceUpload(req, res, next) {
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.startsWith('multipart/form-data')) {
      return next(
        new AppError(
          422,
          'EVIDENCE_EXPECTED',
          'Envie el archivo como multipart/form-data en el campo "file".'
        )
      );
    }

    let busboy;
    try {
      // busboy 1.x es una funcion fabrica (no una clase): se invoca sin new.
      busboy = busboyFactory({
        headers: req.headers,
        limits: { files: 1, fields: 5, fieldSize: 1024, fileSize: hardFileLimitBytes },
      });
    } catch {
      return next(new AppError(422, 'INVALID_MULTIPART', 'La peticion multipart no es valida.'));
    }

    let settled = false;
    let sawFile = false;
    let fileDone = false;
    let tempPath = null;
    let truncated = false;
    const fields = {};

    const disposeTemp = async () => {
      if (!tempPath) return;
      try {
        await fsp.unlink(tempPath);
      } catch {
        // el archivo temporal puede no existir: ignorar
      }
      tempPath = null;
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      req.resume(); // drenar el resto de la peticion
      void disposeTemp().finally(() => next(error));
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      next();
    };

    const finalizeFile = async (mimeType, mediaType, extension, sizeLimitBytes) => {
      if (truncated || sizeLimitBytes === undefined) return; // fail ya se disparo
      if (!tempPath) return;

      const sizeBytes = fs.statSync(tempPath).size;
      if (sizeBytes === 0) {
        return fail(new AppError(422, 'EVIDENCE_EMPTY', 'El archivo esta vacio.'));
      }
      if (sizeBytes > sizeLimitBytes) {
        return fail(
          new AppError(
            422,
            'EVIDENCE_TOO_LARGE',
            `El archivo supera el limite de ${Math.round(sizeLimitBytes / (1024 * 1024))} MB.`
          )
        );
      }

      let valid;
      try {
        valid = await matchesMagicBytes(tempPath, mimeType);
      } catch {
        return fail(
          new AppError(500, 'EVIDENCE_STORAGE_FAILED', 'No se pudo inspeccionar el archivo.')
        );
      }
      if (!valid) {
        return fail(
          new AppError(
            422,
            'EVIDENCE_SIGNATURE_MISMATCH',
            'El contenido del archivo no coincide con el tipo declarado.'
          )
        );
      }

      let declaredDurationSeconds = null;
      if (mediaType === 'VIDEO') {
        const declared = fields['duration_seconds'];
        const parsed = declared === undefined ? NaN : Number(declared);
        if (!Number.isInteger(parsed) || parsed < 1) {
          return fail(
            new AppError(
              422,
              'EVIDENCE_DURATION_REQUIRED',
              'Indique la duracion del video en segundos (duration_seconds).'
            )
          );
        }
        if (parsed > config.EVIDENCE_MAX_VIDEO_SECONDS) {
          return fail(
            new AppError(
              422,
              'EVIDENCE_DURATION_EXCEEDED',
              `El video supera el maximo de ${config.EVIDENCE_MAX_VIDEO_SECONDS} segundos.`
            )
          );
        }
        declaredDurationSeconds = parsed;
      }

      const persistedTempPath = tempPath;
      tempPath = null; // la responsabilidad pasa al controlador

      req.evidenceFile = {
        mediaType,
        mimeType,
        sizeBytes,
        extension,
        declaredDurationSeconds,
        tempPath: persistedTempPath,
        async persistTo(storageKey) {
          const destination = path.join(storageDirectory, storageKey);
          await fsp.mkdir(path.dirname(destination), { recursive: true });
          await fsp.rename(persistedTempPath, destination);
        },
        async dispose() {
          try {
            await fsp.unlink(persistedTempPath);
          } catch {
            // ya fue movido o eliminado: ignorar
          }
        },
      };

      succeed();
    };

    busboy.on('field', (name, value) => {
      fields[name] = value;
    });

    busboy.on('file', (fieldname, fileStream, info) => {
      const { mimeType } = info;
      const spec = IMAGE_SPECS.get(mimeType) ?? VIDEO_SPECS.get(mimeType);
      if (!spec) {
        fileStream.resume();
        return fail(
          new AppError(
            422,
            'EVIDENCE_INVALID_TYPE',
            'Tipo de archivo no permitido. Use JPG, PNG, HEIC/HEIF, MP4 o MOV.'
          )
        );
      }
      if (fieldname !== 'file') {
        fileStream.resume();
        return;
      }
      if (sawFile) {
        fileStream.resume();
        return;
      }
      sawFile = true;

      const mediaType = IMAGE_SPECS.has(mimeType) ? 'IMAGE' : 'VIDEO';
      const sizeLimitBytes = mediaType === 'IMAGE' ? maxImageBytes : maxVideoBytes;
      const currentTempPath = path.join(tempDirectory, `${crypto.randomUUID()}.tmp`);
      tempPath = currentTempPath;
      const writeStream = fs.createWriteStream(currentTempPath);

      fileStream.on('limit', () => {
        truncated = true;
        writeStream.destroy();
        fail(
          new AppError(
            422,
            'EVIDENCE_TOO_LARGE',
            `El archivo supera el limite de ${Math.round(hardFileLimitBytes / (1024 * 1024))} MB.`
          )
        );
      });

      writeStream.on('error', (error) => {
        fail(error);
      });

      writeStream.on('finish', () => {
        if (settled) return;
        fileDone = true;
        void finalizeFile(mimeType, mediaType, spec.extension, sizeLimitBytes);
      });

      fileStream.pipe(writeStream);
    });

    busboy.on('error', () => {
      fail(new AppError(422, 'INVALID_MULTIPART', 'La peticion multipart no es valida.'));
    });

    busboy.on('close', () => {
      if (settled) return;
      if (!sawFile) {
        return fail(
          new AppError(422, 'EVIDENCE_FILE_REQUIRED', 'Falta el archivo en el campo "file".')
        );
      }
      if (fileDone) return; // finalizeFile ya se disparo desde writeStream.finish
      // El archivo termino pero la escritura aun no: dejar que finalize corra
    });

    req.pipe(busboy);
  };
}
