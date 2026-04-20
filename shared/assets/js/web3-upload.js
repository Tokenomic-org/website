/**
 * web3-upload.js — Educator course upload flow.
 *
 *   1. Pin files + metadata JSON to IPFS via the Cloudflare Worker proxy
 *      (which holds the nft.storage / web3.storage API key) or directly to
 *      nft.storage if NFT_STORAGE_TOKEN is exposed at build time.
 *   2. Build a metadata.json describing the course and pin it.
 *   3. Call TokenomicMarket.registerCourse(ipfsURI, priceInUSDC, consultant).
 *
 * Designed to attach to any element via TokenomicUpload.bindForm(formEl, opts).
 */
(function (global) {
  'use strict';

  var ENV = (global.__TKN_ENV) || {};

  // Optional Worker endpoint that proxies pinning. See workers/api-worker.
  // Expected POST endpoints:
  //   POST /ipfs/upload          (multipart/form-data, file field "file")  -> { cid, url }
  //   POST /ipfs/upload-json     (application/json body)                   -> { cid, url }
  var IPFS_UPLOAD_BASE = ENV.IPFS_UPLOAD_BASE || ENV.WORKER_API_BASE || '';
  var NFT_STORAGE_TOKEN = ENV.NFT_STORAGE_TOKEN || ''; // only set in trusted dev builds

  function publicGateway(cid, path) {
    var p = path ? ('/' + String(path).replace(/^\//, '')) : '';
    return 'https://cloudflare-ipfs.com/ipfs/' + cid + p;
  }

  async function uploadFileViaWorker(file) {
    var fd = new FormData();
    fd.append('file', file, file.name);
    var res = await fetch(IPFS_UPLOAD_BASE.replace(/\/$/, '') + '/ipfs/upload', {
      method: 'POST',
      body: fd,
      credentials: 'omit'
    });
    if (!res.ok) throw new Error('Worker upload failed: ' + res.status);
    return await res.json();
  }

  async function uploadJSONViaWorker(json) {
    var res = await fetch(IPFS_UPLOAD_BASE.replace(/\/$/, '') + '/ipfs/upload-json', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(json),
      credentials: 'omit'
    });
    if (!res.ok) throw new Error('Worker upload failed: ' + res.status);
    return await res.json();
  }

  async function uploadFileToNftStorage(file) {
    if (!NFT_STORAGE_TOKEN) throw new Error('No NFT_STORAGE_TOKEN exposed');
    var res = await fetch('https://api.nft.storage/upload', {
      method: 'POST',
      headers: { 'authorization': 'Bearer ' + NFT_STORAGE_TOKEN },
      body: file
    });
    var data = await res.json();
    if (!data || !data.ok) throw new Error('nft.storage upload failed: ' + JSON.stringify(data));
    return { cid: data.value.cid, url: 'ipfs://' + data.value.cid };
  }

  async function uploadJSONToNftStorage(json) {
    var blob = new Blob([JSON.stringify(json)], { type: 'application/json' });
    return uploadFileToNftStorage(blob);
  }

  async function pinFile(file, opts) {
    opts = opts || {};
    if (IPFS_UPLOAD_BASE) {
      try { return await uploadFileViaWorker(file); }
      catch (e) { if (!NFT_STORAGE_TOKEN) throw e; }
    }
    return await uploadFileToNftStorage(file);
  }

  async function pinJSON(json) {
    if (IPFS_UPLOAD_BASE) {
      try { return await uploadJSONViaWorker(json); }
      catch (e) { if (!NFT_STORAGE_TOKEN) throw e; }
    }
    return await uploadJSONToNftStorage(json);
  }

  /**
   * Full educator upload flow.
   * @param {Object}   payload
   * @param {string}   payload.title
   * @param {string}   payload.description
   * @param {File[]}   payload.files       Course content files (videos, PDFs, etc.)
   * @param {string}   payload.priceInUSDC e.g. "49.99"
   * @param {string}   [payload.consultant] Optional 0x... address for revenue share
   * @param {Function} [payload.onProgress] (stage, info) callback
   * @returns {Promise<{courseId, txHash, metadataURI, explorerUrl, fileCids}>}
   */
  async function publishCourse(payload) {
    var onP = payload.onProgress || function () {};
    if (!payload.title) throw new Error('title is required');
    if (!payload.priceInUSDC) throw new Error('priceInUSDC is required');
    if (typeof TokenomicAssets === 'undefined') {
      throw new Error('TokenomicAssets not loaded');
    }
    if (!TokenomicAssets.MARKET_ADDRESS) {
      throw new Error('MARKET_CONTRACT not configured. Set window.__TKN_ENV.MARKET_CONTRACT.');
    }

    var files = payload.files || [];
    var fileCids = [];

    for (var i = 0; i < files.length; i++) {
      onP('uploading-file', { index: i, total: files.length, name: files[i].name });
      var pinned = await pinFile(files[i]);
      fileCids.push({
        name: files[i].name,
        size: files[i].size,
        type: files[i].type,
        cid: pinned.cid,
        ipfsUri: 'ipfs://' + pinned.cid,
        gatewayUrl: publicGateway(pinned.cid)
      });
    }

    onP('uploading-metadata', null);
    var metadata = {
      name: payload.title,
      description: payload.description || '',
      external_url: payload.externalUrl || '',
      image: payload.image || (fileCids[0] ? 'ipfs://' + fileCids[0].cid : ''),
      attributes: [
        { trait_type: 'priceUSDC', value: String(payload.priceInUSDC) },
        { trait_type: 'fileCount', value: fileCids.length }
      ],
      properties: {
        version: 1,
        contentType: 'tokenomic.course.v1',
        files: fileCids,
        consultant: payload.consultant || null,
        publishedAt: new Date().toISOString()
      }
    };

    var pinnedMeta = await pinJSON(metadata);
    var metadataURI = 'ipfs://' + pinnedMeta.cid;

    onP('registering-on-chain', { metadataURI: metadataURI });
    var result = await TokenomicAssets.registerCourseOnChain(
      metadataURI,
      payload.priceInUSDC,
      payload.consultant || ''
    );

    onP('done', result);
    return Object.assign({}, result, {
      metadataURI: metadataURI,
      metadata: metadata,
      fileCids: fileCids
    });
  }

  /**
   * Bind a <form> to publishCourse(). The form should contain inputs:
   *   name="title", name="description", name="priceInUSDC",
   *   name="consultant" (optional), name="files" type="file" multiple
   * Optional descendants used for UX:
   *   [data-tkn-upload-status], [data-tkn-upload-progress],
   *   [data-tkn-upload-submit], [data-tkn-upload-result]
   */
  function bindForm(formEl, opts) {
    opts = opts || {};
    if (!formEl) return;
    if (formEl.dataset.tknBound === '1') return;
    formEl.dataset.tknBound = '1';

    var statusEl = formEl.querySelector('[data-tkn-upload-status]');
    var progressEl = formEl.querySelector('[data-tkn-upload-progress]');
    var resultEl = formEl.querySelector('[data-tkn-upload-result]');
    var submitBtn = formEl.querySelector('[data-tkn-upload-submit]') || formEl.querySelector('button[type=submit]');

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
      if (stage === 'uploading-file' && info) {
        label = 'Uploading file ' + (info.index + 1) + '/' + info.total + ' — ' + info.name;
      } else if (stage === 'uploading-metadata') {
        label = 'Pinning metadata to IPFS…';
      } else if (stage === 'registering-on-chain') {
        label = 'Registering course on Base…';
      } else if (stage === 'done') {
        label = 'Course published!';
      }
      progressEl.textContent = label;
    }

    formEl.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var fd = new FormData(formEl);
      var files = formEl.querySelector('input[type=file]');
      var fileList = files && files.files ? Array.prototype.slice.call(files.files) : [];

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
          resultEl.innerHTML =
            '<div class="tkn-upload-success">' +
              '<div><strong>Course ID:</strong> #' + res.courseId + '</div>' +
              '<div><strong>Metadata:</strong> <a href="https://cloudflare-ipfs.com/ipfs/' +
                res.metadataURI.replace('ipfs://','') + '" target="_blank" rel="noopener">' + res.metadataURI + '</a></div>' +
              '<div><a href="' + res.explorerUrl + '" target="_blank" rel="noopener">View transaction on BaseScan →</a></div>' +
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
    pinFile: pinFile,
    pinJSON: pinJSON,
    publicGateway: publicGateway
  };
})(typeof window !== 'undefined' ? window : this);
