/* UI avatar: IIFE factory; works with file:// and ordinary script tags. */
(function (global) {
  'use strict';
  global.ResumeUIAvatar = { create: function (context) {
  var Store = context.Store;
  var H = context.H;
  var els = context.els;
  var state = context.state;
  var el = context.el;
  var status = context.status;
  var debounce = context.debounce;
  var renderMain = context.renderMain;
  var renderMini = context.renderMini;
  /* ============================================================ 头像上传 */

  /** 头像输出尺寸（3:4 证件照比例） */
  var AVATAR_OUT_W = 480;
  var AVATAR_OUT_H = 640;
  var AVATAR_MAX_BYTES = 1500 * 1024;   /* 压缩后仍超过这个大小就提示 */

  /* 记住最近一次选的原图与检测到的人脸，方便拖动微调时重新裁剪，不用重选文件 */
  var avatarSource = { bitmap: null, face: null, name: '', note: '' };

  function formatBytes(n) {
    return H.formatBytes ? H.formatBytes(n) : String(n) + ' B';
  }

  /** data URL 的实际字节数（base64 去掉前缀后按 3/4 估算） */
  function dataUrlBytes(dataUrl) {
    return H.dataUrlBytes ? H.dataUrlBytes(dataUrl) : 0;
  }

  /**
   * 尝试用浏览器内置的人脸检测找出人脸中心。
   * 没有这个 API（Firefox / 部分 Chrome 版本）或没检测到时返回 null，
   * 由 cropRectFor 的默认取景兜底 —— 所以这条链路不依赖它也能工作。
   */
  function detectFaceCenter(bitmap) {
    return new Promise(function (resolve) {
      if (typeof global.FaceDetector !== 'function') return resolve(null);
      var fd;
      try { fd = new global.FaceDetector({ fastMode: true, maxDetectedFaces: 3 }); }
      catch (e) { return resolve(null); }

      var p;
      try { p = fd.detect(bitmap); } catch (e) { return resolve(null); }
      if (!p || typeof p.then !== 'function') return resolve(null);

      p.then(function (faces) {
        if (!faces || !faces.length) return resolve(null);
        /* 多张脸时取面积最大的那个 */
        var best = faces[0];
        var bestArea = 0;
        faces.forEach(function (f) {
          var b = f.boundingBox || {};
          var area = (b.width || 0) * (b.height || 0);
          if (area > bestArea) { bestArea = area; best = f; }
        });
        var bb = best.boundingBox || {};
        if (!bb.width) return resolve(null);
        resolve({ x: bb.x + bb.width / 2, y: bb.y + bb.height / 2, w: bb.width, h: bb.height });
      }).catch(function () { resolve(null); });
    });
  }

  /** 用当前的取景参数把原图裁成头像并编码 */
  function renderAvatarFromSource(nudge) {
    var bmp = avatarSource.bitmap;
    if (!bmp) return null;

    var rect = (H.cropRectFor ? H.cropRectFor : function () {
      return { sx: 0, sy: 0, sw: bmp.width, sh: bmp.height };
    })({
      iw: bmp.width, ih: bmp.height,
      outW: AVATAR_OUT_W, outH: AVATAR_OUT_H,
      faceCx: avatarSource.face ? avatarSource.face.x : null,
      faceCy: avatarSource.face ? avatarSource.face.y : null,
      nudge: nudge || 0
    });

    var cv = document.createElement('canvas');
    cv.width = AVATAR_OUT_W;
    cv.height = AVATAR_OUT_H;
    var ctx = cv.getContext('2d');

    /* 证件照多为白底：先铺白，透明区域就不会变黑 */
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, AVATAR_OUT_W, AVATAR_OUT_H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, AVATAR_OUT_W, AVATAR_OUT_H);

    var out = cv.toDataURL('image/jpeg', 0.87);
    return {
      dataUrl: out,
      width: AVATAR_OUT_W,
      height: AVATAR_OUT_H,
      bytes: dataUrlBytes(out),
      crop: rect
    };
  }

  /** 读文件 → 解码 → 检测人脸 → 裁剪 */
  function loadAvatarFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();

      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('这个文件不是能识别的图片格式'));
      };

      img.onload = function () {
        var start = function (bitmap) {
          detectFaceCenter(bitmap).then(function (face) {
            avatarSource.bitmap = bitmap;
            avatarSource.face = face;
            avatarSource.name = file.name || '';
            avatarSource.note = face ? '已自动对准人脸' : '未检测到人脸，已按人像常规取景';
            URL.revokeObjectURL(url);
            resolve(avatarSource);
          });
        };

        if (typeof global.createImageBitmap === 'function') {
          global.createImageBitmap(img).then(start).catch(function () { start(img); });
        } else {
          start(img);
        }
      };

      img.src = url;
    });
  }

  /** 刷新设置页里的头像预览 */
  function renderAvatarPreview() {
    if (!els.avatarPreview) return;
    var data = Store.load();
    var src = (data.profile && data.profile.avatar) || '';

    els.avatarPreview.innerHTML = '';
    if (src) {
      var img = document.createElement('img');
      img.src = src;
      img.alt = '头像预览';
      els.avatarPreview.appendChild(img);
      if (els.avatarInfo) {
        els.avatarInfo.textContent = /^data:/.test(src)
          ? '当前：已上传的照片（约 ' + formatBytes(dataUrlBytes(src)) + '）'
          : '当前：' + src;
      }
    } else {
      els.avatarPreview.appendChild(el('div', 'avatar-preview-empty', '暂无头像<br>显示姓名首字'));
      if (els.avatarInfo) els.avatarInfo.textContent = '当前：无（页面会显示姓名首字）';
    }
    if (els.btnAvatarClear) els.btnAvatarClear.disabled = !src;
    /* 没有原图（比如刷新后、或用的是内置占位图）就没法微调 */
    if (els.avatarNudge) els.avatarNudge.disabled = !avatarSource.bitmap;
    if (els.avatarNudgeRow) els.avatarNudgeRow.hidden = !avatarSource.bitmap;
  }

  /** 写入头像并重绘页面 */
  function setAvatar(src, note) {
    Store.update({ 'profile.avatar': src || '' });
    renderMain();
    renderAvatarPreview();
    if (state.draft) { state.draft.profile.avatar = src || ''; renderMini(); }
    if (note) status(els.avatarStatus, note, 'ok');
  }

  /** 拖动微调时实时重新裁剪 */
  var applyNudge = debounce(function () {
    if (!avatarSource.bitmap) return;
    var nudge = Number(els.avatarNudge ? els.avatarNudge.value : 0) / 100;
    var res = renderAvatarFromSource(nudge);
    if (!res) return;
    if (res.bytes > AVATAR_MAX_BYTES) {
      status(els.avatarStatus, '图片过大（' + formatBytes(res.bytes) + '），请换一张', 'err');
      return;
    }
    setAvatar(res.dataUrl, '');
    if (els.avatarInfo) {
      els.avatarInfo.textContent = '当前：已上传的照片（约 ' + formatBytes(res.bytes) + '）';
    }
  }, 200);

  function initAvatar() {
    renderAvatarPreview();
    if (!els.btnAvatarPick || !els.avatarInput) return;

    els.btnAvatarPick.addEventListener('click', function () { els.avatarInput.click(); });

    els.avatarInput.addEventListener('change', function () {
      var f = els.avatarInput.files && els.avatarInput.files[0];
      els.avatarInput.value = '';
      if (!f) return;

      if (!/^image\//.test(f.type)) {
        status(els.avatarStatus, '请选择图片文件（jpg / png / webp）', 'err');
        return;
      }

      status(els.avatarStatus, '正在处理…', '');
      loadAvatarFile(f).then(function () {
        if (els.avatarNudge) els.avatarNudge.value = '0';
        var res = renderAvatarFromSource(0);
        if (!res) throw new Error('裁剪失败');
        if (res.bytes > AVATAR_MAX_BYTES) {
          status(els.avatarStatus,
            '图片压缩后仍有 ' + formatBytes(res.bytes) + '，超过浏览器存储上限，请换一张小一点的', 'err');
          return;
        }
        setAvatar(res.dataUrl,
          '已更新头像（' + res.width + '×' + res.height + '，' + formatBytes(res.bytes) +
          '）· ' + avatarSource.note);
        if (els.avatarInfo) {
          els.avatarInfo.textContent = '当前：已上传的照片（约 ' + formatBytes(res.bytes) + '）· ' +
            avatarSource.note;
        }
      }).catch(function (err) {
        status(els.avatarStatus, '处理失败：' + err.message, 'err');
      });
    });

    if (els.avatarNudge) {
      els.avatarNudge.addEventListener('input', function () {
        if (els.avatarNudgeValue) {
          var v = Number(els.avatarNudge.value);
          els.avatarNudgeValue.textContent = v === 0 ? '居中' : (v < 0 ? '上移 ' + (-v) + '%' : '下移 ' + v + '%');
        }
        applyNudge();
      });
    }

    if (els.btnAvatarClear) {
      els.btnAvatarClear.addEventListener('click', function () {
        avatarSource.bitmap = null;
        avatarSource.face = null;
        setAvatar('', '已移除头像，页面改为显示姓名首字');
      });
    }
  }


  return { renderAvatarPreview: renderAvatarPreview, initAvatar: initAvatar };
  } };
})(typeof window !== 'undefined' ? window : globalThis);
