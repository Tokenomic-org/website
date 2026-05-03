// The slug is published by _layouts/article.html as a data-attribute on
// <section class="article-detail" data-article-slug="..."> so this file
// can stay 100% static (Liquid is not rendered for assets/js/*).
var articleSlug = (function () {
  var el = document.querySelector('[data-article-slug]');
  if (el) return el.getAttribute('data-article-slug') || '';
  // Last-resort: derive from URL (/articles/<slug>/).
  var m = window.location.pathname.match(/\/articles\/([^\/]+)\/?$/);
  return m ? m[1] : '';
})();

function formatCommentDate(isoStr) {
  var d = new Date(isoStr);
  var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var now = new Date();
  var diff = Math.floor((now - d) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  if (diff < 604800) return Math.floor(diff / 86400) + "d ago";
  return months[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
}

function renderComment(c) {
  function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  var safeAuthor = esc(c.author || "Anonymous");
  var safeText = esc(c.text);
  var initials = (c.author || "A").split(" ").map(function(w){return w[0];}).join("").substring(0,2).toUpperCase();
  return '<li class="comment-item">' +
    '<div class="comment-header">' +
    '<div class="comment-avatar">' + esc(initials) + '</div>' +
    '<div><span class="comment-author">' + safeAuthor + '</span>' +
    '<div class="comment-date">' + formatCommentDate(c.created_at) + '</div></div>' +
    '</div>' +
    '<p class="comment-text">' + safeText + '</p>' +
    '</li>';
}

function loadArticleComments() {
  fetch("/api/articles/" + articleSlug + "/comments")
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var list = document.getElementById("comments-list");
      var count = document.getElementById("comment-count");
      var noMsg = document.getElementById("no-comments-msg");
      if (data.comments && data.comments.length > 0) {
        if (noMsg) noMsg.style.display = "none";
        var html = "";
        data.comments.forEach(function(c) { html += renderComment(c); });
        list.innerHTML = html;
        count.textContent = data.comments.length;
      }
    })
    .catch(function() {});
}

function submitArticleComment() {
  var btn = document.getElementById("submit-comment");
  var msg = document.getElementById("comment-msg");
  var author = document.getElementById("comment-author").value.trim();
  var text = document.getElementById("comment-text").value.trim();

  if (!text) { msg.textContent = "Please enter a comment."; msg.className = "form-msg error"; return; }

  btn.disabled = true;
  btn.textContent = "Posting...";
  msg.textContent = "";

  var wallet = "";
  if (typeof TokenomicWallet !== "undefined" && TokenomicWallet.account) {
    wallet = TokenomicWallet.account;
  }

  fetch("/api/articles/" + articleSlug + "/comments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ author: author || "Anonymous", text: text, wallet: wallet })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.success) {
      msg.textContent = "Comment posted!"; msg.className = "form-msg success";
      document.getElementById("comment-text").value = "";
      loadArticleComments();
    } else {
      msg.textContent = data.error || "Failed to post."; msg.className = "form-msg error";
    }
  })
  .catch(function() { msg.textContent = "Network error."; msg.className = "form-msg error"; })
  .finally(function() { btn.disabled = false; btn.textContent = "Post Comment"; });
}

function copyArticleLink(btn) {
  var url = "https://tokenomic.org/articles/" + articleSlug;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(function() {
      btn.classList.add("copied");
      setTimeout(function() { btn.classList.remove("copied"); }, 2000);
    });
  } else {
    var input = document.createElement("input");
    input.value = url; document.body.appendChild(input);
    input.select(); document.execCommand("copy");
    document.body.removeChild(input);
    btn.classList.add("copied");
    setTimeout(function() { btn.classList.remove("copied"); }, 2000);
  }
}

document.addEventListener("DOMContentLoaded", loadArticleComments);

