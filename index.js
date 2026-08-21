// index.js

// ********** DECLARAÇÕES **********

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
  
  if (!license.ativo) {
    return res.status(403).json({
      error: 'Esta licença foi desativada.',
    });
  }

  if (license.expiracao && license.expiracao < new Date()) {
    return res.status(403).json({ error: 'Licença expirada.' });
  }

  if (license.id_maquina && license.id_maquina !== machineId) {
    return res.status(409).json({
      error:
        'Esta licença já está em uso em outra máquina. Desative-a lá antes de ativar aqui.',
    });
  }

  license.id_maquina = machineId;
  if (!license.ultima_ativacao) {
    license.ultima_ativacao = new Date();
  }
  
  license.historico_ativacoes.push({ id_maquina: machineId, acao: 'ACTIVATE' });
  await license.save();

  res.json({
    ok: true,
    message: 'Licença ativada com sucesso.',
    plan: license.plano,
    latestVersion: "1.0.1"
  });
});

// ********** DESATIVAR (LIBERAR PRA OUTRA MÁQUINA) **********

app.post('/license/deactivate', async (req, res) => {
  const { licenseKey, machineId } = req.body;

  const license = await License.findOne({ licenseKey });
  if (!license) {
    return res.status(404).json({ error: 'Serial não encontrado.' });
  }
  if (license.id_maquina !== machineId) {
    return res
      .status(403)
      .json({ error: 'Esta máquina não é a ativa para este serial.' });
  }

  license.historico_ativacoes.push({ id_maquina: machineId, acao: 'DEACTIVATE' });
  license.id_maquina = null;
  await license.save();

  res.json({ ok: true, message: 'Licença desativada.' });
});

// ********** VALIDAR (o app chama periodicamente) **********

app.post('/license/validate', async (req, res) => {
  const { licenseKey, machineId } = req.body;
  const license = await License.findOne({ licenseKey });
  if (!license || !license.ativo || license.id_maquina !== machineId) {
    return res.status(403).json({ valid: false });
  }
  if (license.expiracao && license.expiracao < new Date()) {
    return res.status(403).json({ valid: false, reason: 'expired' });
  }
  res.json({ 
    valid: true, 
    plan: license.plano,
    latestVersion: "1.0.1"
  });
});

// ********** INICIAR SERVIDOR **********

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});