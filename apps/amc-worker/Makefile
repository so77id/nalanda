# amc-worker — see README.md for what each target is for.
#
# Everything runs in Docker; nothing is installed on the host. That is not a
# preference here but a requirement: AMC is a Debian package with an OpenCV and
# LaTeX dependency tree that has no good native path on macOS.

IMAGE ?= nalanda/amc-worker:dev
PLATFORM ?= linux/arm64
COPIES ?= 40

.PHONY: build test verify shell clean size

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
