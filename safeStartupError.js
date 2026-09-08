// atelor-server/safeStartupError.js

// ********** CONSTANTES **********

const MAX_SAFE_MESSAGE_LENGTH = 500;
const CONTROL_CHARACTERS_PATTERN = /[\u0000-\u001f\u007f]+/g;
const URI_CREDENTIALS_PATTERN =
  /\b([a-z][a-z0-9+.-]*:\/\/)[^@\s]+@/gi;
const SENSITIVE_QUERY_PATTERN =
  /([?&](?:access_token|api[_-]?key|auth|password|passwd|secret|token)=)[^&#\s]*/gi;

// ********** FUNÇÕES **********

function messageFrom(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Erro não identificado.";
}

function formatSafeStartupError(error) {
  return messageFrom(error)
    .replace(CONTROL_CHARACTERS_PATTERN, " ")
    .replace(URI_CREDENTIALS_PATTERN, "$1[credenciais ocultas]@")
    .replace(SENSITIVE_QUERY_PATTERN, "$1[valor oculto]")
    .trim()
    .slice(0, MAX_SAFE_MESSAGE_LENGTH);
}

// ********** EXPORTAÇÕES **********

module.exports = { formatSafeStartupError };
