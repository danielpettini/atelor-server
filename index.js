// index.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const License = require('./License');

const app = express();
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// ********** CONEXÃO COM O BANCO **********

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log('Conectado ao MongoDB com sucesso.'))
  .catch((err) => console.error('Erro ao conectar no MongoDB:', err));

// ********** ROTA DE TESTE **********

app.get('/', (req, res) => {
  res.json({ status: 'ATELOR License Server está no ar.' });
});

// ********** ATIVAR LICENÇA NESTA MÁQUINA **********

app.post('/license/activate', async (req, res) => {
  const { licenseKey, machineId } = req.body;

  if (!licenseKey || !machineId) {
    return res.status(400).json({ error: 'Dados incompletos.' });
  }

  const license = await License.findOne({ licenseKey });

  if (!license) {
    return res.status(404).json({ error: 'Serial não encontrado.' });
  }
  if (!license.isActive) {
    return res.status(403).json({
      error: license.revokedReason || 'Esta licença foi desativada.',
    });
  }
  if (license.expiresAt && license.expiresAt < new Date()) {
    return res.status(403).json({ error: 'Licença expirada.' });
  }

  // Já vinculada a OUTRA máquina
  if (license.machineId && license.machineId !== machineId) {
    return res.status(409).json({
      error:
        'Esta licença já está em uso em outra máquina. Desative-a lá antes de ativar aqui.',
    });
  }

  // Primeira ativação ou reativação na MESMA máquina
  license.machineId = machineId;
  if (!license.activatedAt) {
    license.activatedAt = new Date();
  }
  license.activationHistory.push({ machineId, action: 'ACTIVATE' });
  await license.save();

  res.json({
    ok: true,
    message: 'Licença ativada com sucesso.',
    plan: license.plan,
  });
});

// ********** DESATIVAR (LIBERAR PRA OUTRA MÁQUINA) **********

app.post('/license/deactivate', async (req, res) => {
  const { licenseKey, machineId } = req.body;

  const license = await License.findOne({ licenseKey });
  if (!license) {
    return res.status(404).json({ error: 'Serial não encontrado.' });
  }
  if (license.machineId !== machineId) {
    return res
      .status(403)
      .json({ error: 'Esta máquina não é a ativa para este serial.' });
  }

  license.activationHistory.push({ machineId, action: 'DEACTIVATE' });
  license.machineId = null;
  await license.save();

  res.json({ ok: true, message: 'Licença desativada.' });
});

// ********** VALIDAR (o app chama periodicamente) **********

app.post('/license/validate', async (req, res) => {
  const { licenseKey, machineId } = req.body;

  const license = await License.findOne({ licenseKey });

  if (!license || !license.isActive || license.machineId !== machineId) {
    return res.status(403).json({ valid: false });
  }
  if (license.expiresAt && license.expiresAt < new Date()) {
    return res.status(403).json({ valid: false, reason: 'expired' });
  }

  res.json({ valid: true, plan: license.plan });
});

// ********** INICIAR SERVIDOR **********

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});