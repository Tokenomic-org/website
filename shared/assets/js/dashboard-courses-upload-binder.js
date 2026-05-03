document.addEventListener('DOMContentLoaded', function () {
  var f = document.getElementById('tkn-educator-upload');
  if (f && window.TokenomicUpload) window.TokenomicUpload.bindForm(f);
});
