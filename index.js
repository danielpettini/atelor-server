// atelor-server/index.js

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const License = require("./License");

const app = express();

// ********** MIDDLEWARES **********

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.json());

// ********** CONEXÃO COM O BANCO **********

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("Conectado ao MongoDB com sucesso."))
  .catch((err) => {
    console.error("Erro ao conectar no MongoDB:", err);
    process.exit(1);
  });

// ********** ROTA DE TESTE **********

app.get("/", (req, res) => {
  res.json({ status: "ATELOR License Server está no ar." });
});

// ********** ATIVAR LICENÇA NESTA MÁQUINA **********

app.post("/license/activate", async (req, res, next) => {
  try {
    const { licenseKey, machineId } = req.body;

    if (!licenseKey || !machineId) {
      return res.status(400).json({ error: "Dados incompletos." });
    }

    const license = await License.findOne({ licenseKey });

    if (!license) {
      return res.status(404).json({ error: "Serial não encontrado." });
    }

    if (!license.ativo) {
      return res.status(403).json({ error: "Esta licença foi desativada." });
    }

    if (license.expiracao && license.expiracao < new Date()) {
      return res.status(403).json({ error: "Licença expirada." });
    }

    if (license.id_maquina && license.id_maquina !== machineId) {
      return res.status(409).json({
        error:
          "Esta licença já está em uso em outra máquina. Desative-a lá antes de ativar aqui.",
      });
    }

    license.id_maquina = machineId;
    if (!license.ultima_ativacao) {
      license.ultima_ativacao = new Date();
    }

    license.historico_ativacoes.push({
      id_maquina: machineId,
      acao: "ACTIVATE",
    });
    await license.save();

    return res.json({
      ok: true,
      message: "Licença ativada com sucesso.",
      plan: license.plano,
      latestVersion: "1.0.1",
    });
  } catch (error) {
    next(error);
  }
});

// ********** DESATIVAR (LIBERAR PRA OUTRA MÁQUINA) **********

app.post("/license/deactivate", async (req, res, next) => {
  try {
    const { licenseKey, machineId } = req.body;

    const license = await License.findOne({ licenseKey });
    if (!license) {
      return res.status(404).json({ error: "Serial não encontrado." });
    }

    if (license.id_maquina !== machineId) {
      return res
        .status(403)
        .json({ error: "Esta máquina não é a ativa para este serial." });
    }

    license.historico_ativacoes.push({
      id_maquina: machineId,
      acao: "DEACTIVATE",
    });
    license.id_maquina = null;
    await license.save();

    return res.json({ ok: true, message: "Licença desativada." });
  } catch (error) {
    next(error);
  }
});

// ********** VALIDAR (o app chama periodicamente) **********

app.post("/license/validate", async (req, res, next) => {
  try {
    const { licenseKey, machineId } = req.body;

    if (!licenseKey || !machineId) {
      return res
        .status(400)
        .json({ valid: false, error: "Dados incompletos." });
    }

    const license = await License.findOne({ licenseKey });
    if (!license || !license.ativo || license.id_maquina !== machineId) {
      return res.status(403).json({ valid: false });
    }

    if (license.expiracao && license.expiracao < new Date()) {
      return res.status(403).json({ valid: false, reason: "expired" });
    }

    return res.json({
      valid: true,
      plan: license.plano,
      latestVersion: "1.0.1",
    });
  } catch (error) {
    next(error);
  }
});

// ********** MIDDLEWARE GLOBAL DE TRATAMENTO DE ERROS **********

app.use((err, req, res, next) => {
  console.error("Erro interno no servidor:", err);
  res
    .status(500)
    .json({ error: "Erro interno no servidor. Tente novamente mais tarde." });
});

// ********** INICIAR SERVIDOR **********

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
