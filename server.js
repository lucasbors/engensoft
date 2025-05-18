const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const fs = require('fs');


const app = express();

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const nomeUnico = Date.now() + '-' + file.originalname;
    cb(null, nomeUnico);
  }
});
const upload = multer({ storage });



const PORT = 3000;

// Configurações do app
app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


// Conexão com banco de dados SQLite
const db = new sqlite3.Database('./banco.db', (err) => {
  if (err) return console.error(err.message);
  console.log('💾 Conectado ao banco de dados SQLite');
});

// Cria a tabela de usuários se não existir
db.run(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario TEXT UNIQUE NOT NULL,
    senha TEXT NOT NULL,
    tipo TEXT DEFAULT 'comum'
  )
`);

// Cria a tabela de documentos com novos campos
db.run(`
  CREATE TABLE IF NOT EXISTS documentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    data TEXT NOT NULL,
    arquivo TEXT NOT NULL,
    usuario TEXT NOT NULL,
    observacao TEXT,
    criado_em TEXT NOT NULL,
    alterado_em TEXT
  )
`);



// Garante o usuário admin
db.get(`SELECT * FROM usuarios WHERE usuario = ?`, ['admin'], (err, row) => {
  if (!row) {
    db.run(`INSERT INTO usuarios (usuario, senha, tipo) VALUES (?, ?, ?)`, ['admin', 'admin123', 'admin']);
    console.log('👤 Usuário admin criado automaticamente.');
  }
});

// Login
app.post('/login', (req, res) => {
  const { usuario, senha } = req.body;

  db.get(
    `SELECT * FROM usuarios WHERE usuario = ? AND senha = ?`,
    [usuario, senha],
    (err, row) => {
      if (err) {
        return res.status(500).json({ sucesso: false, mensagem: 'Erro no servidor.' });
      }

      if (row) {
        // Envia também o tipo de usuário
        res.json({ sucesso: true, tipo: row.tipo });
      } else {
        res.json({ sucesso: false, mensagem: 'Usuário ou senha inválidos.' });
      }
    }
  );
});


// Criar novo usuário
app.post('/criar-usuario', (req, res) => {
  const { usuario, senha } = req.body;

  db.run(
    `INSERT INTO usuarios (usuario, senha, tipo) VALUES (?, ?, ?)`,
    [usuario, senha, 'comum'],
    function (err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.json({ sucesso: false, mensagem: 'Usuário já existe.' });
        }
        return res.json({ sucesso: false, mensagem: 'Erro ao criar usuário.' });
      }

      res.json({ sucesso: true, mensagem: 'Usuário criado com sucesso!' });
    }
  );
});

// Listar todos os usuários
app.get('/usuarios', (req, res) => {
  db.all(`SELECT usuario, tipo FROM usuarios`, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ sucesso: false, mensagem: 'Erro ao listar usuários.' });
    }

    res.json(rows);
  });
});

// Rota para salvar documento
app.post('/documentos', upload.single('arquivo'), (req, res) => {
  const { nome, data, usuario, observacao } = req.body;
  const arquivo = req.file?.filename;
  const criado_em = new Date().toISOString();

  if (!nome || !data || !arquivo || !usuario) {
    return res.status(400).json({ sucesso: false, mensagem: 'Campos obrigatórios faltando.' });
  }

  db.run(
    `INSERT INTO documentos (nome, data, arquivo, usuario, observacao, criado_em) VALUES (?, ?, ?, ?, ?, ?)`,
    [nome, data, arquivo, usuario, observacao || null, criado_em],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ sucesso: false, mensagem: 'Erro ao salvar documento.' });
      }

      res.json({ sucesso: true, id: this.lastID });
    }
  );
});


// Rota para listar documentos de um usuário
app.get('/documentos/:usuario', (req, res) => {
  const usuario = req.params.usuario;

  db.all(
    `SELECT id, nome, data, arquivo FROM documentos WHERE usuario = ? ORDER BY id DESC`,
    [usuario],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ sucesso: false, mensagem: 'Erro ao buscar documentos.' });
      }

      res.json(rows);
    }
  );
});

app.get('/documentos/detalhes/:id', (req, res) => {
  const id = req.params.id;

  db.get(`SELECT * FROM documentos WHERE id = ?`, [id], (err, row) => {
    if (err || !row) {
      return res.status(404).json({ mensagem: 'Documento não encontrado.' });
    }

    res.json(row);
  });
});

app.put('/documentos/:id', upload.single('arquivo'), (req, res) => {
  const id = req.params.id;
  const { nome, data, observacao } = req.body;
  const novoArquivo = req.file?.filename;
  const alterado_em = new Date().toISOString();

  if (!nome || !data) {
    return res.status(400).json({ sucesso: false, mensagem: 'Campos obrigatórios faltando.' });
  }

  // Primeiro, busca o arquivo antigo
  db.get(`SELECT arquivo FROM documentos WHERE id = ?`, [id], (err, row) => {
    if (err || !row) {
      return res.status(404).json({ sucesso: false, mensagem: 'Documento não encontrado.' });
    }

    const arquivoAntigo = row.arquivo;

    // Monta a query de atualização
    const query = `
      UPDATE documentos
      SET nome = ?, data = ?, observacao = ?, alterado_em = ?, ${novoArquivo ? 'arquivo = ?,' : ''} usuario = usuario
      WHERE id = ?
    `;
    const params = novoArquivo
      ? [nome, data, observacao || null, alterado_em, novoArquivo, id]
      : [nome, data, observacao || null, alterado_em, id];

    db.run(query, params, function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ sucesso: false, mensagem: 'Erro ao atualizar documento.' });
      }

      // Remove o arquivo antigo se um novo foi enviado
      if (novoArquivo && arquivoAntigo) {
        const caminho = path.join(__dirname, 'uploads', arquivoAntigo);
        fs.unlink(caminho, (err) => {
          if (err) console.warn("Erro ao apagar arquivo antigo (pode não existir):", err.message);
        });
      }

      res.json({ sucesso: true, mensagem: 'Documento atualizado com sucesso.' });
    });
  });
});

app.get('/documentos/busca', (req, res) => {
  const { usuario, termo } = req.query;

  if (!usuario || !termo) {
    return res.status(400).json([]);
  }

  db.all(
    `SELECT nome FROM documentos WHERE usuario = ? AND nome LIKE ? ORDER BY id DESC`,
    [usuario, `%${termo}%`],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json([]);
      }

      res.json(rows);
    }
  );
});

app.delete('/documentos/:id', (req, res) => {
  const id = req.params.id;

  db.get(`SELECT arquivo FROM documentos WHERE id = ?`, [id], (err, row) => {
    if (err || !row) {
      return res.status(404).json({ sucesso: false, mensagem: 'Documento não encontrado.' });
    }

    const caminho = path.join(__dirname, 'uploads', row.arquivo);
    fs.unlink(caminho, (err) => {
      if (err) console.warn('Erro ao apagar o arquivo:', err.message);
    });

    db.run(`DELETE FROM documentos WHERE id = ?`, [id], function (err) {
      if (err) {
        return res.status(500).json({ sucesso: false, mensagem: 'Erro ao excluir documento.' });
      }

      res.json({ sucesso: true, mensagem: 'Documento excluído com sucesso.' });
    });
  });
});


// Inicia servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});

app.delete('/usuarios/:usuario', (req, res) => {
  const usuario = req.params.usuario;

  if (usuario === 'admin') {
    return res.json({ sucesso: false, mensagem: 'Não é permitido excluir o usuário admin.' });
  }

  db.run(`DELETE FROM usuarios WHERE usuario = ?`, [usuario], function(err) {
    if (err) {
      return res.status(500).json({ sucesso: false, mensagem: 'Erro ao excluir usuário.' });
    }

    if (this.changes === 0) {
      return res.json({ sucesso: false, mensagem: 'Usuário não encontrado.' });
    }

    res.json({ sucesso: true, mensagem: `Usuário "${usuario}" excluído com sucesso!` });
  });
});

