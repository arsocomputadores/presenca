require('dotenv').config();
const { getPool } = require('../lib/db');
(async () => {
  const pool = await getPool();
  if (!pool) {
    console.error('MySQL não habilitado (USE_MYSQL!=true) ou pool não criado');
    process.exit(1);
  }
  try {
    // Find user Milena
    const [users] = await pool.query("SELECT id, nome FROM usuarios WHERE nome LIKE ? LIMIT 1", ['%Milena%']);
    if (!users || users.length === 0) {
      console.error('Usuário com nome contendo "Milena" não encontrado');
      process.exit(1);
    }
    const user = users[0];
    console.log('Encontrado usuário:', user.id, user.nome);

    // Find turma 6º A (attempts)
    const [turmas] = await pool.query("SELECT id, nome FROM turmas WHERE nome LIKE ? OR nome = ? LIMIT 1", ['%6%A%', '6º A']);
    if (!turmas || turmas.length === 0) {
      // fallback broad search
      const [t2] = await pool.query("SELECT id, nome FROM turmas WHERE nome LIKE ? LIMIT 1", ['%6%']);
      if (!t2 || t2.length === 0) {
        console.error('Turma 6º A não encontrada');
        process.exit(1);
      }
      turmas.push(t2[0]);
    }
    const turma = turmas[0];
    console.log('Encontrado turma:', turma.id, turma.nome);

    // Update turma
    await pool.query('UPDATE turmas SET professor_conselheiro_id = ?, conselheiro_pode_lancar = 1 WHERE id = ?', [user.id, turma.id]);
    console.log(`Vinculado usuário ${user.nome} (id=${user.id}) como conselheiro da turma ${turma.nome} (id=${turma.id}) e habilitado para lançar.`);

    // Show resulting row
    const [res] = await pool.query('SELECT id, nome, professor_conselheiro_id, conselheiro_pode_lancar FROM turmas WHERE id = ?', [turma.id]);
    console.log('Turma atualizada:', res[0]);
  } catch (err) {
    console.error('Erro:', err.message);
    process.exit(1);
  } finally {
    try { await pool.end(); } catch(e){}
  }
})();
