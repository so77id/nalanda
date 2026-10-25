// The chunked scan upload (issue #339, ADR-0088): a scan batch sent in
// 1 MiB chunks, each its own short request, so the server's 15 s read
// deadline never cuts it, resumed from what the server holds after a dropped
// link, a restarted server or an expired session.
//
// It enhances every form[data-chunked-upload] on the page (the attribute is
// the URL that opens an upload) and drives the status block the template
// partial chunked_upload_status draws inside it. Without this file the form
// posts to its one-request route as it always did.
//
// A first-party module under /static/js/, per ADR-0047 §4: stateful
// behaviour is never authored inline in a template. Nothing in `go test`
// runs it; every change to it is checked in a real browser
// (testing-strategy.md §apps/server, "inline browser scripts").
(function () {
  // Without these the form keeps its one-request post.
  if (!window.fetch || !window.AbortController || !window.DOMParser || !window.Blob || !Blob.prototype.slice) {
    return;
  }

  var MB = 1048576;
  // A request that has not answered in a minute is treated as a dropped
  // link: the server cuts any body at 15 s anyway.
  var REQUEST_TIMEOUT_MS = 60000;
  var MAX_BACKOFF_MS = 30000;

  var SAY_OPENING = "Preparando la subida…";
  var SAY_OFFLINE = "Sin conexión, reintentando…";
  var SAY_FINISHING = "Terminando la subida…";
  var SAY_RESUMING = "Retomando la subida…";
  var SAY_CANCELLED = "Subida cancelada.";
  var SAY_SESSION = "Tu sesión expiró: inicia sesión en otra pestaña y aprieta Reintentar.";
  var SAY_LOST = "La subida se perdió: pasó más de un día sin recibir datos. Vuelve a subir el archivo.";

  function megabytes(n) {
    return (n / MB).toFixed(1).replace(".", ",");
  }

  document.querySelectorAll("form[data-chunked-upload]").forEach(enhance);

  function enhance(form) {
    var startURL = form.getAttribute("data-chunked-upload");
    var fileInput = form.querySelector('input[type="file"]');
    var tokenInput = form.querySelector('input[name="csrf_token"]');
    var submit = form.querySelector('button[type="submit"]');
    var box = form.querySelector("[data-chunked-status]");
    if (!startURL || !fileInput || !tokenInput || !box) {
      return;
    }
    var bar = box.querySelector("progress");
    var line = box.querySelector("[data-chunked-line]");
    var retryButton = box.querySelector("[data-chunked-retry]");
    var cancelButton = box.querySelector("[data-chunked-cancel]");

    // The upload in progress, or null.
    var job = null;

    form.addEventListener("submit", function (event) {
      var file = fileInput.files && fileInput.files[0];
      if (!file) {
        return; // the browser's own "required" message
      }
      event.preventDefault();
      if (job) {
        return;
      }
      job = {
        file: file, upload: "", chunks: "", complete: "", chunk: MB, received: 0,
        stopped: false, paused: false, backoff: 0, completeLost: false,
        controller: null, wake: null
      };
      busy(true);
      run(job);
    });

    cancelButton.addEventListener("click", cancel);
    retryButton.addEventListener("click", resume);

    window.addEventListener("beforeunload", function (event) {
      if (job && !job.stopped) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
    // Back online: stop waiting out the back-off.
    window.addEventListener("online", function () {
      if (job && job.wake) {
        job.wake();
      }
    });

    function say(text) {
      line.textContent = text;
    }

    function busy(on) {
      box.hidden = false;
      bar.hidden = !on;
      cancelButton.hidden = !on;
      retryButton.hidden = true;
      fileInput.disabled = on;
      if (submit) {
        submit.disabled = on;
      }
    }

    // Where the chunks, the status and Cancelar go: the start answer says,
    // like the complete URL, so this file knows no route of the server's.
    function uploadURL(j) {
      return j.chunks;
    }

    // call sends one request and says what came back: "json" (with status
    // and data), "session" (the gate answered with a page — the session
    // expired, or its token went stale after signing in again) or "network"
    // (nothing came back, or something between here and the server broke).
    async function call(j, method, url, body, contentType) {
      var controller = new AbortController();
      j.controller = controller;
      var timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
      var headers = { "X-CSRF-Token": tokenInput.value };
      if (contentType) {
        headers["Content-Type"] = contentType;
      }
      try {
        var response = await fetch(url, {
          method: method, body: body, headers: headers,
          credentials: "same-origin", cache: "no-store", signal: controller.signal
        });
        var type = response.headers.get("Content-Type") || "";
        if (type.indexOf("application/json") !== 0) {
          if (response.status === 204) {
            return { kind: "json", status: 204, data: {} };
          }
          return { kind: response.status >= 500 ? "network" : "session" };
        }
        return { kind: "json", status: response.status, data: await response.json() };
      } catch (error) {
        return { kind: "network" };
      } finally {
        clearTimeout(timer);
        j.controller = null;
      }
    }

    async function run(j) {
      if (!j.upload && !(await open(j))) {
        return;
      }
      while (!j.stopped && !j.paused) {
        if (j.received >= j.file.size) {
          await finish(j);
        } else {
          await sendChunk(j);
        }
      }
    }

    function startBody(file) {
      var body = { size: file.size, name: file.name, type: file.type };
      var ticked = form.querySelector('input[name="ticked"]');
      var unsure = form.querySelector('input[name="unsure"]');
      if (ticked) {
        body.ticked = ticked.value;
      }
      if (unsure) {
        body.unsure = unsure.value;
      }
      return JSON.stringify(body);
    }

    async function open(j) {
      say(SAY_OPENING);
      while (!j.stopped) {
        var answer = await call(j, "POST", startURL, startBody(j.file), "application/json");
        if (j.stopped) {
          return false;
        }
        if (answer.kind === "session") {
          pauseForSession(j);
          return false;
        }
        if (answer.kind === "json" && answer.status === 201) {
          j.upload = answer.data.upload;
          j.chunks = answer.data.chunks;
          j.complete = answer.data.complete;
          j.chunk = answer.data.chunk || MB;
          j.received = answer.data.received || 0;
          j.backoff = 0;
          return true;
        }
        if (answer.kind === "json" && answer.status < 500) {
          fail(j, answer.data.message);
          return false;
        }
        await waitOut(j);
      }
      return false;
    }

    function showProgress(j) {
      bar.max = j.file.size;
      bar.value = j.received;
      say("Subiendo… " + megabytes(j.received) + " de " + megabytes(j.file.size) + " MB");
    }

    async function sendChunk(j) {
      showProgress(j);
      var end = Math.min(j.received + j.chunk, j.file.size);
      var answer = await call(j, "PUT", uploadURL(j) + "?offset=" + j.received,
        j.file.slice(j.received, end), "application/octet-stream");
      if (j.stopped) {
        return;
      }
      if (answer.kind === "session") {
        pauseForSession(j);
        return;
      }
      if (answer.kind === "json") {
        var data = answer.data;
        if (answer.status === 200) {
          j.received = data.received;
          j.backoff = 0;
          return;
        }
        if (answer.status === 404) {
          fail(j, SAY_LOST);
          return;
        }
        // A wrong offset (409), or a chunk cut part-way by the deadline
        // (408) or the link (400): the server says what it holds, and the
        // upload goes on from there — after a pause if nothing got through.
        if (typeof data.received === "number" &&
            (answer.status === 409 || answer.status === 408 || answer.status === 400)) {
          var progressed = data.received > j.received;
          j.received = data.received;
          if (progressed) {
            j.backoff = 0;
          } else if (answer.status !== 409) {
            await waitOut(j);
          }
          return;
        }
        if (answer.status < 500) {
          fail(j, data.message);
          return;
        }
      }
      await waitOut(j);
      await resync(j);
    }

    // resync asks what the server holds — after any error, and after
    // signing in again.
    async function resync(j) {
      var answer = await call(j, "GET", uploadURL(j), undefined, "");
      if (j.stopped) {
        return;
      }
      if (answer.kind === "session") {
        pauseForSession(j);
      } else if (answer.kind === "json" && answer.status === 200) {
        j.received = answer.data.received;
      } else if (answer.kind === "json" && answer.status === 404) {
        fail(j, SAY_LOST);
      }
      // Anything else: the next chunk tries again, and waits if it must.
    }

    async function finish(j) {
      say(SAY_FINISHING);
      var answer = await call(j, "POST", j.complete, undefined, "");
      if (j.stopped) {
        return;
      }
      if (answer.kind === "session") {
        pauseForSession(j);
        return;
      }
      if (answer.kind === "json") {
        var data = answer.data;
        if (answer.status === 200) {
          j.stopped = true; // no "leave the page?" on the way out
          window.location.assign(data.redirect);
          return;
        }
        if (answer.status === 409 && typeof data.received === "number") {
          j.received = data.received;
          return;
        }
        // A complete whose answer was lost already turned the upload into
        // a batch: the page's list of batches is the truth.
        if (answer.status === 404 && j.completeLost) {
          j.stopped = true;
          window.location.reload();
          return;
        }
        if (answer.status < 500) {
          fail(j, data.message);
          return;
        }
      }
      j.completeLost = true;
      await waitOut(j);
    }

    // waitOut backs off — 1, 2, 4 … 30 s — and never gives up while the tab
    // is open; Cancelar is the professor's.
    async function waitOut(j) {
      var delay = Math.min(1000 * Math.pow(2, j.backoff), MAX_BACKOFF_MS);
      j.backoff++;
      say(SAY_OFFLINE);
      await new Promise(function (resolve) {
        j.wake = resolve;
        setTimeout(resolve, delay);
      });
      j.wake = null;
    }

    function pauseForSession(j) {
      j.paused = true;
      say(SAY_SESSION);
      retryButton.hidden = false;
    }

    // resume is Reintentar after signing in again: the new session has a
    // new token, which the page this form lives on now carries.
    async function resume() {
      var j = job;
      if (!j || j.stopped) {
        return;
      }
      retryButton.hidden = true;
      say(SAY_RESUMING);
      await refreshToken();
      j.paused = false;
      j.backoff = 0;
      if (j.upload) {
        await resync(j);
      }
      if (!j.stopped && !j.paused) {
        run(j);
      }
    }

    async function refreshToken() {
      try {
        var response = await fetch(window.location.href, { credentials: "same-origin", cache: "no-store" });
        var page = new DOMParser().parseFromString(await response.text(), "text/html");
        var fresh = page.querySelector('input[name="csrf_token"]');
        if (fresh && fresh.value) {
          tokenInput.value = fresh.value;
        }
      } catch (error) {
        // The next request says whether the session is back.
      }
    }

    function forget(j) {
      if (j.upload) {
        fetch(uploadURL(j), {
          method: "DELETE", headers: { "X-CSRF-Token": tokenInput.value }, credentials: "same-origin"
        }).catch(function () {});
      }
    }

    function fail(j, message) {
      j.stopped = true;
      forget(j);
      job = null;
      busy(false);
      say(message || SAY_LOST);
    }

    function cancel() {
      var j = job;
      if (!j) {
        return;
      }
      j.stopped = true;
      if (j.controller) {
        j.controller.abort();
      }
      if (j.wake) {
        j.wake();
      }
      forget(j);
      job = null;
      busy(false);
      say(SAY_CANCELLED);
    }
  }
})();
