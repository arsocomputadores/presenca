require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getPool } = require('../lib/db');
(async () => {
  const pool = await getPool();
  if (!pool) {
    console.error('Pool de BD não disponível (USE_MYSQL provavelmente false)');
    process.exit(1);
  }
  try {
    // Ensure backup dir
    const backupDir = path.join(__dirname, '..', 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `turmas_conselheiro_backup_${ts}.csv`);

    // Check columns
    const [cols] = await pool.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='turmas' AND COLUMN_NAME IN ('professor_conselheiro_id','conselheiro_pode_lancar')");
    const existingCols = cols.map(r => r.COLUMN_NAME);
    console.log('Colunas encontradas na tabela turmas:', existingCols);

    // Check FK constraint name
    const [constraints] = await pool.query("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='turmas' AND COLUMN_NAME='professor_conselheiro_id' AND REFERENCED_TABLE_NAME IS NOT NULL");
    const fkName = constraints.length ? constraints[0].CONSTRAINT_NAME : null;
    console.log('Constraint encontrada:', fkName || '(nenhuma)');

    // Backup selected columns
    console.log('Exportando backup da tabela turmas para', backupFile);
    const [rows] = await pool.query('SELECT id, nome, professor_conselheiro_id, conselheiro_pode_lancar FROM turmas');
    const out = fs.createWriteStream(backupFile, { encoding: 'utf8' });
    out.write('id,nome,professor_conselheiro_id,conselheiro_pode_lancar\n');
    for (const r of rows) {
      const line = `${r.id},"${(r.nome||'').replace(/"/g,'""')}",${r.professor_conselheiro_id===null?'':r.professor_conselheiro_id},${r.conselheiro_pode_lancar===null?'':r.conselheiro_pode_lancar}\n`;
      out.write(line);
    }
    out.end();
    console.log('Backup escrito com', rows.length, 'linhas');

    // Drop FK if exists
    if (fkName) {
      try {
        await pool.query(`ALTER TABLE turmas DROP FOREIGN KEY \`${fkName}\``);
        console.log('Constraint', fkName, 'removida');
      } catch (e) {
        console.error('Erro ao remover FK', fkName, e.message);
      }
    }

    // Drop columns if exist
    if (existingCols.length) {
      try {
        // Build drop list
        const drops = [];
        if (existingCols.includes('professor_conselheiro_id')) drops.push('DROP COLUMN professor_conselheiro_id');
        if (existingCols.includes('conselheiro_pode_lancar')) drops.push('DROP COLUMN conselheiro_pode_lancar');
        if (drops.length) {
          const sql = `ALTER TABLE turmas ${drops.join(', ')}`;
          await pool.query(sql);
          console.log('Colunas removidas:', drops.join(', '));
        }
      } catch (e) {
        console.error('Erro ao remover colunas', e.message);
      }
    } else {
      console.log('Nenhuma coluna para remover');
    }

    // Verify
    const [colsAfter] = await pool.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='turmas' AND COLUMN_NAME IN ('professor_conselheiro_id','conselheiro_pode_lancar')");
    console.log('Colunas remanescentes:', colsAfter.map(r => r.COLUMN_NAME));

  } catch (err) {
    console.error('Erro geral:', err.message);
    process.exit(1);
  } finally {
    try { await pool.end(); } catch(e){}
  }
})();
