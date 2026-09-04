// atelor-server/updateMetadata.js

// ********** IMPORTAÇÕES **********

const fs = require("fs");
const path = require("path");

// ********** MÓDULO PRINCIPAL **********

const MAX_UPDATE_BYTES = 512 * 1024 * 1024;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function validateUpdateMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Manifesto de atualização inválido.");
  }
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "sha256,size,version") {
    throw new TypeError("Manifesto de atualização contém campos inválidos.");
  }

  const version = typeof value.version === "string" ? value.version.trim() : "";
  const sha256 =
    typeof value.sha256 === "string" ? value.sha256.trim().toLowerCase() : "";
  const size = value.size;

  if (version.length > 64 || !VERSION_PATTERN.test(version)) {
    throw new TypeError("Versão do manifesto inválida.");
  }
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new TypeError("Checksum do manifesto inválido.");
  }
  if (
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > MAX_UPDATE_BYTES
  ) {
    throw new TypeError("Tamanho do manifesto inválido.");
  }

  return Object.freeze({ version, sha256, size });
}

function loadUpdateMetadata({
  manifestPath = path.join(__dirname, "update-manifest.json"),
  logger = console,
} = {}) {
  let serialized;
  try {
    serialized = fs.readFileSync(manifestPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    logger.warn?.(`Manifesto de atualização indisponível: ${error.message}`);
    return null;
  }

  try {
    return validateUpdateMetadata(JSON.parse(serialized));
  } catch (error) {
    logger.warn?.(`Manifesto de atualização ignorado: ${error.message}`);
    return null;
  }
}

module.exports = {
  MAX_UPDATE_BYTES,
  loadUpdateMetadata,
  validateUpdateMetadata,
};
