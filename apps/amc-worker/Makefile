# amc-worker — see README.md for what each target is for.
#
# Everything runs in Docker; nothing is installed on the host. That is not a
# preference here but a requirement: AMC is a Debian package with an OpenCV and
# LaTeX dependency tree that has no good native path on macOS.

IMAGE ?= nalanda/amc-worker:dev
PLATFORM ?= linux/arm64
COPIES ?= 40
PAPER_COPIES ?= 6
PAPER_MIN_COPIES ?= 3

.PHONY: build test verify shell clean size serve measure paper read-paper paper-min read-paper-min

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
##   The two `cp` lines mirror `stage_source` in tests/lib.sh, which this recipe
##   does not source: that file is a bash test harness (set -euo pipefail, the
##   check counters) and a make recipe has no business pulling it in. So a
##   fixture that grows another asset has to be added in BOTH places, and this
##   is the copy whose drift is found on printed paper.
paper:
	mkdir -p tests/work/paper/src/code tests/work/paper/out \
		tests/work/paper/scan tests/work/paper/project/data \
		tests/work/paper/project/cr tests/work/paper/project/scans
	cp tests/fixtures/control-demo.tex tests/work/paper/src/
	cp -R tests/fixtures/code/. tests/work/paper/src/code/
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

## paper-min — produce the minimum paper check control (PAPER-CHECK-MIN.md).
##   Same shape as `paper` but against control-paper-min.tex: 1 page per copy,
##   1 question, RUT block with a column-number header. Default 3 copies.
##   `make paper-min PAPER_MIN_COPIES=n` for a different count.
paper-min:
	mkdir -p tests/work/paper-min/src tests/work/paper-min/out \
		tests/work/paper-min/scan tests/work/paper-min/project/data \
		tests/work/paper-min/project/cr tests/work/paper-min/project/scans
	cp tests/fixtures/control-paper-min.tex tests/work/paper-min/src/
	docker run --rm --env DISPLAY= -v "$(PWD)/tests/work/paper-min:/work" -w /work $(IMAGE) \
		bash -c 'set -e; \
		  auto-multiple-choice prepare --mode s --n-copies $(PAPER_MIN_COPIES) --with pdflatex \
		    --data /work/project/data --prefix /work/project/ \
		    --out-sujet /work/out/control-min-para-imprimir.pdf \
		    --out-calage /work/out/calage.xy /work/src/control-paper-min.tex >/dev/null; \
		  auto-multiple-choice meptex --data /work/project/data --src /work/out/calage.xy >/dev/null'
	@echo
	@echo "Print SINGLE-SIDED at 100% scale (not 'fit to page'), one page per copy:"
	@echo "  apps/amc-worker/tests/work/paper-min/out/control-min-para-imprimir.pdf"
	@echo "Then follow apps/amc-worker/PAPER-CHECK-MIN.md from step 2."

## read-paper-min — read the min-check scanned batch back
##   Expects the scan at tests/work/paper-min/scan/lote.pdf
##   Same command chain as read-paper — the reader does not care that the
##   source is a different fixture.
read-paper-min:
	docker run --rm --env DISPLAY= -v "$(PWD)/tests/work/paper-min:/work" -w /work $(IMAGE) \
		bash -c 'set -e; \
		  auto-multiple-choice getimages --list /work/project/scans/list.txt \
		    --vector-density 300 --copy-to /work/project/scans /work/scan/lote.pdf >/dev/null; \
		  auto-multiple-choice analyse --data /work/project/data --projet /work/project \
		    --cr /work/project/cr --multiple \
		    --liste-fichiers /work/project/scans/list.txt >/dev/null; \
		  N=$$(python3 -c "import sys; sys.path.insert(0, sys.argv[1]); import read_capture; print(read_capture.printed_copies(sys.argv[2]))" \
		    /opt/amc-worker /work/project/data); \
		  auto-multiple-choice prepare --mode b --with pdflatex \
		    --n-copies "$$N" \
		    --data /work/project/data --prefix /work/project \
		    /work/src/control-paper-min.tex >/dev/null; \
		  auto-multiple-choice note --data /work/project/data --seuil 0.3 >/dev/null; \
		  python3 /opt/amc-worker/read_capture.py --data /work/project/data'

## read-paper — read the scanned batch back (step 4 of PAPER-CHECK.md)
##   Expects the scan at tests/work/paper/scan/lote.pdf
##   `prepare --mode b` and `note` are not optional and go AFTER `analyse`
##   (worker.py TRAP 3): they build the scoring database the reader needs to
##   tell a multiple-answer question from a simple one and to say what each
##   question was worth. Without them the reader refuses — which is the point,
##   but it would refuse in the middle of a paper check, with a marked pile
##   already scanned.
##   The copy count is DERIVED from the layout rather than taken from
##   PAPER_COPIES, because this target is invoked bare (PAPER-CHECK.md step 4)
##   while `make paper` may have been given a different count. Taking the
##   variable here would score six copies of a forty-copy pile and then refuse
##   the batch with a remedy that cannot work (#147 review, COR-8).
read-paper:
	docker run --rm --env DISPLAY= -v "$(PWD)/tests/work/paper:/work" -w /work $(IMAGE) \
		bash -c 'set -e; \
		  auto-multiple-choice getimages --list /work/project/scans/list.txt \
		    --vector-density 300 --copy-to /work/project/scans /work/scan/lote.pdf >/dev/null; \
		  auto-multiple-choice analyse --data /work/project/data --projet /work/project \
		    --cr /work/project/cr --multiple \
		    --liste-fichiers /work/project/scans/list.txt >/dev/null; \
		  N=$$(python3 -c "import sys; sys.path.insert(0, sys.argv[1]); import read_capture; print(read_capture.printed_copies(sys.argv[2]))" \
		    /opt/amc-worker /work/project/data); \
		  auto-multiple-choice prepare --mode b --with pdflatex \
		    --n-copies "$$N" \
		    --data /work/project/data --prefix /work/project \
		    /work/src/control-demo.tex >/dev/null; \
		  auto-multiple-choice note --data /work/project/data --seuil 0.3 >/dev/null; \
		  python3 /opt/amc-worker/read_capture.py --data /work/project/data'
