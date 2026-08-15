# amc-worker — see README.md for what each target is for.
#
# Everything runs in Docker; nothing is installed on the host. That is not a
# preference here but a requirement: AMC is a Debian package with an OpenCV and
# LaTeX dependency tree that has no good native path on macOS.

IMAGE ?= nalanda/amc-worker:dev
PLATFORM ?= linux/arm64
COPIES ?= 40
PAPER_COPIES ?= 6

.PHONY: build test verify shell clean size serve measure paper read-paper

## build — build the image
build:
	docker build --platform $(PLATFORM) -t $(IMAGE) .

## test — run every verification script (the per-commit protocol)
test:
	@fail=0; \
	for t in tests/[0-9]*.sh; do \
		AMC_IMAGE=$(IMAGE) "$$t" || fail=1; \
		echo; \
	done; \
	exit $$fail

## verify — build, then test (the pre-PR protocol)
verify: build test

## shell — an interactive shell in the image, for exploring AMC by hand
shell:
	docker run --rm -it --env DISPLAY= -v "$(PWD)/tests/work:/work" $(IMAGE) bash

## size — the measurement AC-8 asks for
size:
	@docker image inspect $(IMAGE) --format '{{.Size}}' \
		| awk '{ printf "%s: %.2f GB (%d bytes)\n", "$(IMAGE)", $$1/1024/1024/1024, $$1 }'

## clean — remove generated work directories, keep the image
clean:
	rm -rf tests/work

## serve — run the HTTP wrapper against a local work directory
serve:
	docker run --rm -it --env DISPLAY= -p 127.0.0.1:8080:8080 \
		-v "$(PWD)/tests/work/serve:/work" $(IMAGE)

## measure — time a real-sized batch (AC-8). Not part of `test`: it reports, it does not assert.
##   make measure COPIES=5   — a make variable, so it must be passed through explicitly;
##   make does not export its variables to the recipe's shell.
measure:
	COPIES=$(COPIES) AMC_IMAGE=$(IMAGE) tests/measure-batch.sh

## paper — produce the printable control for the manual paper check
##   The one verification no agent can run. See PAPER-CHECK.md.
##   Does the setup too: an earlier version of that document told the reader to
##   run `prepare` against a source directory nothing created, and never ran
##   `meptex` at all — so `analyse` would later read an EMPTY layout and the
##   whole print-mark-scan cycle would produce nothing (#138 review, F-8).
paper:
	mkdir -p tests/work/paper/src tests/work/paper/out \
		tests/work/paper/scan tests/work/paper/project/data \
		tests/work/paper/project/cr tests/work/paper/project/scans
	cp tests/fixtures/control-demo.tex tests/work/paper/src/
	docker run --rm --env DISPLAY= -v "$(PWD)/tests/work/paper:/work" -w /work $(IMAGE) \
		bash -c 'set -e; \
		  auto-multiple-choice prepare --mode s --n-copies $(PAPER_COPIES) --with pdflatex \
		    --data /work/project/data --prefix /work/project/ \
		    --out-sujet /work/out/control-para-imprimir.pdf \
		    --out-calage /work/out/calage.xy /work/src/control-demo.tex >/dev/null; \
		  auto-multiple-choice meptex --data /work/project/data --src /work/out/calage.xy >/dev/null'
	@echo
	@echo "Print this DOUBLE-SIDED at 100% scale (not 'fit to page'):"
	@echo "  apps/amc-worker/tests/work/paper/out/control-para-imprimir.pdf"
	@echo "Then follow apps/amc-worker/PAPER-CHECK.md from step 2."

## read-paper — read the scanned batch back (step 4 of PAPER-CHECK.md)
##   Expects the scan at tests/work/paper/scan/lote.pdf
read-paper:
	docker run --rm --env DISPLAY= -v "$(PWD)/tests/work/paper:/work" -w /work $(IMAGE) \
		bash -c 'set -e; \
		  auto-multiple-choice getimages --list /work/project/scans/list.txt \
		    --vector-density 300 --copy-to /work/project/scans /work/scan/lote.pdf >/dev/null; \
		  auto-multiple-choice analyse --data /work/project/data --projet /work/project \
		    --cr /work/project/cr --multiple \
		    --liste-fichiers /work/project/scans/list.txt >/dev/null; \
		  python3 /opt/amc-worker/read_capture.py --data /work/project/data'
