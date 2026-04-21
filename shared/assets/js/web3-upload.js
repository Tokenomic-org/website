/**
 * web3-upload.js — Educator course upload flow.
 *
 *   1. Ask the api-worker for a one-time Cloudflare Stream upload URL.
 *   2. Browser POSTs the video file directly to Cloudflare Stream.
 *   3. POST course metadata (title, description, price, consultant, files[])
 *      to the api-worker so it's persisted under stream-meta:<uid> in KV.
 *   4. Call TokenomicMarket.registerCourse("stream:<uid>", priceInUSDC, consultant).
 *
 * No course files ever land in the agent worker — the browser uploads
 * straight to Cloudflare Stream, and the worker only mints the upload
 * ticket using its server-side CF_STREAM_TOKEN secret.
 */
(function (global) {
  'use strict';

  var ENV = (global.__TKN_ENV) || {};

  // api-worker base URL. The Stream endpoints live under /stream/*.
  var API_BASE = (ENV.API_BASE || ENV.WORKER_API_BASE || '').replace(/\/$/, '');

  function streamUri(uid)   { return 'stream:' + uid; }
  function streamEmbed(uid) {
    var sub = ENV.STREAM_CUSTOMER_SUBDOMAIN || '';
    return sub ? ('https://' + sub + '/' + uid + '/iframe') : '';
  }
  function streamHls(uid) {
    var sub = ENV.STREAM_CUSTOMER_SUBDOMAIN || '';
    return sub ? ('https://' + sub + '/' + uid + '/manifest/video.m3u8') : '';
  }

  /**
   * Mint a Cloudflare Stream Direct Creator Upload URL via the api-worker.
   * @param {Object} opts
   * @param {string} [opts.name]
   * @param {string} [opts.creator]   wallet address
   * @param {Object} [opts.meta]
   * @param {number} [opts.maxDurationSeconds]
   */
  async function requestUploadTicket(opts) {
    if (!API_BASE) throw new Error('API_BASE not configured');
    var res = await fetch(API_BASE + '/stream/direct-upload', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-wallet': (opts && opts.creator) || ''
      },
      credentials: 'omit',
      body: JSON.stringify({
        name: opts && opts.name,
        creator: opts && opts.creator,
        meta: opts && opts.meta,
        maxDurationSeconds: opts && opts.maxDurationSeconds
      })
    });
    if (!res.ok) {
      var err = await res.text().catch(function () { return ''; });
      throw new Error('Stream ticket failed: ' + res.status + ' ' + err);
    }
    return await res.json();
  }

  /**
   * Upload a single File/Blob to a previously-minted Stream upload URL.
   * Cloudflare Stream's Direct Creator Upload endpoint accepts a
   * multipart/form-data POST with field "file".
   */
  async function uploadToStream(uploadURL, file, onProgress) {
    return await new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', uploadURL, true);
      xhr.upload.addEventListener('progress', function (e) {
        if (e.lengthComputable && typeof onProgress === 'function') {
          onProgress(e.loaded, e.total);
        }
      });
      xhr.onerror = function () { reject(new Error('Upload network error')); };
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) resolve(true);
        else reject(new Error('Upload failed: ' + xhr.status + ' ' + xhr.responseText));
      };
      var fd = new FormData();
      fd.append('file', file, (file && file.name) || 'video');
      xhr.send(fd);
    });
  }

  /**
   * Poll /stream/:uid until the asset is ready (or maxWaitMs elapses).
   */
  async function waitForReady(uid, maxWaitMs) {
    var deadline = Date.now() + (maxWaitMs || 120000);
    while (Date.now() < deadline) {
      try {
        var res = await fetch(API_BASE + '/stream/' + uid, { credentials: 'omit' });
        if (res.ok) {
          var j = await res.json();
          if (j.ready) return j;
        }
      } catch (_) {}
      await new Promise(function (r) { setTimeout(r, 3000); });
    }
    return { ready: false };
  }

  /**
   * Persist course metadata server-side, keyed by Stream uid.
   */
  async function saveMetadata(uid, metadata) {
    var res = await fetch(API_BASE + '/stream/' + uid + '/json-meta', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify(metadata)
    });
    if (!res.ok) throw new Error('saveMetadata failed: ' + res.status);
    return await res.json();
  }

  /**
   * Full educator upload flow.
   * @param {Object}   payload
   * @param {string}   payload.title
   * @param {string}   payload.description
   * @param {File[]}   payload.files       Course content files (videos primarily)
   * @param {string}   payload.priceInUSDC e.g. "49.99"
   * @param {string}   [payload.consultant] Optional 0x... address for revenue share
   * @param {Function} [payload.onProgress] (stage, info) callback
   * @returns {Promise<{courseId, txHash, contentURI, embedUrl, hlsUrl, streamUid}>}
   */
  async function publishCourse(payload) {
    var onP = payload.onProgress || function () {};
    if (!payload.title) throw new Error('title is required');
    if (!payload.priceInUSDC) throw new Error('priceInUSDC is required');
    if (typeof TokenomicAssets === 'undefined') throw new Error('TokenomicAssets not loaded');
    if (!TokenomicAssets.MARKET_ADDRESS) {
      throw new Error('MARKET_CONTRACT not configured. Set window.__TKN_ENV.MARKET_CONTRACT.');
    }

    var files = payload.files || [];
    if (!files.length) throw new Error('At least one video file is required');
    var primary = files[0];

    onP('requesting-upload-url', { name: primary.name, size: primary.size });
    var ticket = await requestUploadTicket({
      name: payload.title,
      creator: payload.consultant || '',
      meta: { courseTitle: payload.title }
    });

    onP('uploading-video', { name: primary.name, size: primary.size, uid: ticket.uid });
    await uploadToStream(ticket.uploadURL, primary, function (loaded, total) {
      onP('upload-progress', { loaded: loaded, total: total, percent: Math.round(loaded * 100 / total) });
    });

    onP('encoding', { uid: ticket.uid });
    var ready = await waitForReady(ticket.uid, 5 * 60 * 1000);

    var metadata = {
      name: payload.title,
      description: payload.description || '',
      external_url: payload.externalUrl || '',
      attributes: [
        { trait_type: 'priceUSDC', value: String(payload.priceInUSDC) },
        { trait_type: 'storage',   value: 'cloudflare-stream' }
      ],
      properties: {
        version: 1,
        contentType: 'tokenomic.course.v2',
        stream: {
          uid: ticket.uid,
          embed: (ready && ready.embed) || streamEmbed(ticket.uid),
          hls:   (ready && ready.playback && ready.playback.hls) || streamHls(ticket.uid),
          duration: (ready && ready.duration) || 0
        },
        consultant: payload.consultant || null,
        publishedAt: new Date().toISOString()
      }
    };

    onP('saving-metadata', { uid: ticket.uid });
    await saveMetadata(ticket.uid, metadata);

    var contentURI = streamUri(ticket.uid);
    onP('registering-on-chain', { contentURI: contentURI });
    var result = await TokenomicAssets.registerCourseOnChain(
      contentURI,
      payload.priceInUSDC,
      payload.consultant || ''
    );

    onP('done', result);
    return Object.assign({}, result, {
      contentURI: contentURI,
      streamUid:  ticket.uid,
      embedUrl:   metadata.properties.stream.embed,
      hlsUrl:     metadata.properties.stream.hls,
      metadata:   metadata
    });
  }

  /**
   * Bind a <form> to publishCourse(). The form should contain inputs:
   *   name="title", name="description", name="priceInUSDC",
   *   name="consultant" (optional), name="files" type="file" (video)
   */
  function bindForm(formEl, opts) {
    opts = opts || {};
    if (!formEl || formEl.dataset.tknBound === '1') return;
    formEl.dataset.tknBound = '1';

    var statusEl   = formEl.querySelector('[data-tkn-upload-status]');
    var progressEl = formEl.querySelector('[data-tkn-upload-progress]');
    var resultEl   = formEl.querySelector('[data-tkn-upload-result]');
    var submitBtn  = formEl.querySelector('[data-tkn-upload-submit]') || formEl.querySelector('button[type=submit]');

    function setStatus(msg, kind) {
      if (statusEl) {
        statusEl.textContent = msg;
        statusEl.dataset.kind = kind || 'info';
      }
    }
    function setBusy(busy) {
      if (submitBtn) submitBtn.disabled = !!busy;
      formEl.classList.toggle('is-busy', !!busy);
    }
    function setProgress(stage, info) {
      if (!progressEl) return;
      var label = stage;
      if (stage === 'requesting-upload-url') label = 'Requesting Cloudflare Stream upload URL…';
      else if (stage === 'uploading-video')  label = 'Uploading ' + info.name + '…';
      else if (stage === 'upload-progress')  label = 'Uploading: ' + info.percent + '%';
      else if (stage === 'encoding')         label = 'Cloudflare Stream is encoding the video…';
      else if (stage === 'saving-metadata')  label = 'Saving course metadata…';
      else if (stage === 'registering-on-chain') label = 'Registering course on Base…';
      else if (stage === 'done')             label = 'Course published!';
      progressEl.textContent = label;
    }

    formEl.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var fd = new FormData(formEl);
      var fileInput = formEl.querySelector('input[type=file]');
      var fileList = fileInput && fileInput.files ? Array.prototype.slice.call(fileInput.files) : [];

      setBusy(true);
      setStatus('Publishing…', 'info');
      try {
        var res = await publishCourse({
          title: fd.get('title'),
          description: fd.get('description'),
          priceInUSDC: fd.get('priceInUSDC'),
          consultant: fd.get('consultant'),
          files: fileList,
          onProgress: setProgress
        });
        setStatus('Course published! Course ID: #' + res.courseId, 'success');
        if (resultEl) {
          var iframeHtml = res.embedUrl
            ? '<div class="tkn-upload-preview"><iframe src="' + res.embedUrl + '" allow="accelerometer; gyroscope; encrypted-media; picture-in-picture;" allowfullscreen></iframe></div>'
            : '';
          resultEl.innerHTML =
            '<div class="tkn-upload-success">' +
              '<div><strong>Course ID:</strong> #' + res.courseId + '</div>' +
              '<div><strong>Stream UID:</strong> <code>' + res.streamUid + '</code></div>' +
              '<div><strong>Content URI:</strong> <code>' + res.contentURI + '</code></div>' +
              '<div><a href="' + res.explorerUrl + '" target="_blank" rel="noopener">View transaction on BaseScan →</a></div>' +
              iframeHtml +
            '</div>';
        }
        if (typeof opts.onSuccess === 'function') opts.onSuccess(res);
      } catch (err) {
        console.error('publishCourse failed:', err);
        setStatus('Failed: ' + (err && err.message || err), 'error');
        if (typeof opts.onError === 'function') opts.onError(err);
      } finally {
        setBusy(false);
      }
    });
  }

  global.TokenomicUpload = {
    publishCourse: publishCourse,
    bindForm: bindForm,
    requestUploadTicket: requestUploadTicket,
    uploadToStream: uploadToStream,
    waitForReady: waitForReady,
    saveMetadata: saveMetadata,
    streamUri: streamUri,
    streamEmbed: streamEmbed,
    streamHls: streamHls
  };
})(typeof window !== 'undefined' ? window : this);
