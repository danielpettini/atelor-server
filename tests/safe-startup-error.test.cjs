// atelor-server/tests/safe-startup-error.test.cjs

// ********** IMPORTAÇÕES **********

const assert = require("node:assert/strict");
const test = require("node:test");

const { formatSafeStartupError } = require("../safeStartupError");

// ********** TESTES **********

test("oculta credenciais de URI sem apagar o destino do diagnóstico", () => {
  const uri = [
    "mongodb",
    "+srv",
    "://",
    "private-user",
    ":",
    "private-password",
    "@cluster.invalid/database",
  ].join("");
  const output = formatSafeStartupError(new Error(`Falha ao conectar ${uri}`));

  assert.doesNotMatch(output, /private-user|private-password/);
  assert.match(output, /\[credenciais ocultas\]@cluster\.invalid/);
});

test("oculta parâmetros sensíveis e remove controles do log", () => {
  const output = formatSafeStartupError(
    "Falha\nhttps://example.invalid/path?token=private-value&room=12",
  );

  assert.doesNotMatch(output, /private-value|\n/);
  assert.match(output, /token=\[valor oculto\]&room=12/);
});

test("limita mensagens e trata valores de erro desconhecidos", () => {
  assert.equal(formatSafeStartupError({ reason: "private" }), "Erro não identificado.");
  assert.equal(formatSafeStartupError("x".repeat(700)).length, 500);
});
