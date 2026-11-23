fetch('/api/install').then(response => response.json()).then(access => {
  const link = document.getElementById('mobile-url');
  link.href = access.publicUrl || location.origin;
  link.textContent = access.publicUrl || location.origin;
  if (!access.publicUrl) { document.querySelector('.install-qr').hidden = true; document.querySelector('.install-box h2').textContent = '手机打开下方网址'; }
  if (access.localUrl) document.getElementById('local-url').textContent = '同一 Wi-Fi 备用地址：' + access.localUrl + '（仅浏览器预览）';
}).catch(() => {});
