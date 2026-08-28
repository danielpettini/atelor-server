const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  loadUpdateMetadata,
  validateUpdateMetadata,
} = require("../updateMetadata");

function createTemporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atelor-server-manifest-test-"));
}

function removeTemporaryDirectory(directory) {
  const resolved = path.resolve(directory);
  const expectedPrefix = path.resolve(
    os.tmpdir(),
    "atelor-server-manifest-test-",
  );
  assert.ok(resolved.startsWith(expectedPrefix));
  fs.rmSync(resolved, { recursive: true, force: true });
}

test("valida e normaliza um manifesto completo", () => {
  const manifest = validateUpdateMetadata({
    version: "1.0.2",
    sha256: "A".repeat(64),
    size: 123,
  });
  assert.deepEqual(manifest, {
    version: "1.0.2",
    sha256: "a".repeat(64),
    size: 123,
  });
  assert.equal(Object.isFrozen(manifest), true);
});

test("recusa coerção de tamanho e campos extras como URL", () => {
  const base = {
    version: "1.0.2",
    sha256: "a".repeat(64),
    size: 123,
  };
  assert.throws(
    () => validateUpdateMetadata({ ...base, size: "123" }),
    /Tamanho/,
  );
  assert.throws(
    () => validateUpdateMetadata({ ...base, url: "https://example.com" }),
    /campos inválidos/,
  );
});

test("manifesto ausente desabilita atualização sem derrubar licenciamento", () => {
  const directory = createTemporaryDirectory();
  const warnings = [];
  try {
    const result = loadUpdateMetadata({
      manifestPath: path.join(directory, "missing.json"),
      logger: { warn: (value) => warnings.push(value) },
    });
    assert.equal(result, null);
    assert.deepEqual(warnings, []);
  } finally {
    removeTemporaryDirectory(directory);
  }
});

test("manifesto inválido é ignorado com aviso", () => {
  const directory = createTemporaryDirectory();
  const manifestPath = path.join(directory, "update-manifest.json");
  const warnings = [];
  fs.writeFileSync(manifestPath, "{\"version\":", "utf8");

  try {
    const result = loadUpdateMetadata({
      manifestPath,
      logger: { warn: (value) => warnings.push(value) },
    });
    assert.equal(result, null);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /ignorado/);
  } finally {
    removeTemporaryDirectory(directory);
  }
});
