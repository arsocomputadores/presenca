function padCodigo(codigo) {
  const digits = String(codigo || '').replace(/\D/g, '');
  return digits.replace(/^0+(?=\d)/, '');
}

function setStatus(alunoId, status, btn) {
  const group = btn.closest('.freq-status-group');
  group.querySelectorAll('.freq-btn').forEach((b) => {
    b.classList.remove('active-P', 'active-F', 'active-J');
  });
  btn.classList.add('active-' + status);
  document.getElementById('status_' + alunoId).value = status;
}

function setStatusFromButton(btn) {
  const alunoId = btn.dataset.alunoId;
  const status = btn.dataset.status;
  setStatus(alunoId, status, btn);
}

function marcarTodos(status) {
  document.querySelectorAll('.freq-status-group').forEach((group) => {
    const alunoId = group.dataset.aluno;
    group.querySelectorAll('.freq-btn').forEach((b) => {
      b.classList.remove('active-P', 'active-F', 'active-J');
      if (b.dataset.status === status) {
        b.classList.add('active-' + status);
      }
    });
    document.getElementById('status_' + alunoId).value = status;
  });
}

function filtrarAlunos(termo) {
  const q = termo.toLowerCase();
  document.querySelectorAll('.aluno-check-item').forEach((item) => {
    const busca = item.dataset.busca || '';
    item.style.display = busca.includes(q) ? '' : 'none';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const codigo = document.getElementById('codigo');
  const nome = document.getElementById('nome');
  const preview = document.getElementById('preview-codigo-nome');

  function atualizarPreview() {
    if (!preview) return;
    const c = padCodigo(codigo?.value || '') || '0';
    const n = nome?.value?.trim() || 'Nome do aluno';
    preview.textContent = c + ' - ' + n;
  }

  codigo?.addEventListener('input', atualizarPreview);
  nome?.addEventListener('input', atualizarPreview);
  atualizarPreview();

  const alertSucesso = document.getElementById('alert-freq-sucesso');
  if (alertSucesso) {
    alertSucesso.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => {
      alertSucesso.classList.add('alert-save-success-visible');
    }, 50);
  }
});
