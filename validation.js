const MAX_LICENSE_KEY_LENGTH = 256;
const LICENSE_KEY_CONTROL_PATTERN = /[\u0000-\u001F\u007F-\u009F]/u;
const NATIVE_MACHINE_ID_PATTERN = /^[a-f0-9]{64}$/;
const LEGACY_MACHINE_ID_PATTERN = /^pc-[a-z0-9]{8,32}$/;

class RequestValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "RequestValidationError";
    this.status = 400;
    this.code = "INVALID_REQUEST";
  }
}

function assertPlainObject(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new RequestValidationError("O corpo da requisição é inválido.");
  }
}

function assertAllowedKeys(value, allowedKeys) {
  const unexpectedKey = Object.keys(value).find(
    (key) => !allowedKeys.has(key),
  );
  if (unexpectedKey) {
    throw new RequestValidationError("O corpo da requisição contém campos inválidos.");
  }
}

function normalizeLicenseKey(value) {
  if (typeof value !== "string") {
    throw new RequestValidationError("A chave de licença é inválida.");
  }
  if (LICENSE_KEY_CONTROL_PATTERN.test(value)) {
    throw new RequestValidationError("A chave de licença é inválida.");
  }
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  if (length < 1 || length > MAX_LICENSE_KEY_LENGTH) {
    throw new RequestValidationError("A chave de licença é inválida.");
  }
  return normalized;
}

function normalizeMachineId(value) {
  if (typeof value !== "string") {
    throw new RequestValidationError("A identificação da máquina é inválida.");
  }
  const normalized = value.trim().toLowerCase();
  if (
    !NATIVE_MACHINE_ID_PATTERN.test(normalized) &&
    !LEGACY_MACHINE_ID_PATTERN.test(normalized)
  ) {
    throw new RequestValidationError("A identificação da máquina é inválida.");
  }
  return normalized;
}

function normalizeLegacyMachineId(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new RequestValidationError("A identificação legada é inválida.");
  }
  const normalized = value.trim().toLowerCase();
  if (!LEGACY_MACHINE_ID_PATTERN.test(normalized)) {
    throw new RequestValidationError("A identificação legada é inválida.");
  }
  return normalized;
}

function parseLicenseCredentials(body, { allowLegacyProof = false } = {}) {
  assertPlainObject(body);
  const allowedKeys = new Set(["licenseKey", "machineId"]);
  if (allowLegacyProof) allowedKeys.add("legacyMachineId");
  assertAllowedKeys(body, allowedKeys);

  const licenseKey = normalizeLicenseKey(body.licenseKey);
  const machineId = normalizeMachineId(body.machineId);
  const legacyMachineId = allowLegacyProof
    ? normalizeLegacyMachineId(body.legacyMachineId)
    : undefined;

  if (
    legacyMachineId &&
    !NATIVE_MACHINE_ID_PATTERN.test(machineId)
  ) {
    throw new RequestValidationError(
      "A migração exige uma identificação nativa da máquina.",
    );
  }

  return { licenseKey, machineId, legacyMachineId };
}

module.exports = {
  LEGACY_MACHINE_ID_PATTERN,
  MAX_LICENSE_KEY_LENGTH,
  NATIVE_MACHINE_ID_PATTERN,
  RequestValidationError,
  normalizeLicenseKey,
  normalizeMachineId,
  parseLicenseCredentials,
};
