.POSIX:
.PHONY: help test validate check dev-install install uninstall dev-uninstall uninstall-plugin

help:
	@echo 'test            run all suites (one suite: node test/test-<name>.js)'
	@echo 'validate        claude plugin validate'
	@echo 'check           test + validate'
	@echo 'dev-install     hook this repo directly, no reinstall on edit'
	@echo 'install         real plugin install (tests packaging)'
	@echo 'uninstall       remove both install modes'

test:
	@./test/run-all.sh

validate:
	@claude plugin validate .

check: test validate

# Two mutually exclusive install modes. Hooks from every source run in
# parallel, so having both registered opens two pages per question; each
# target clears the other.

# Points at the working tree, so a hook edit needs no reinstall.
dev-install: uninstall-plugin
	@node scripts/dev-hooks.js add
	@echo 'restart this session (or start one here) to load it'

# Installs the copy under ~/.claude/plugins/cache, so it exercises the
# manifest and marketplace resolution the project hook bypasses. The copy is
# a snapshot: re-run after every hook edit.
install: dev-uninstall
	@claude plugin marketplace add ./ 2>/dev/null || true
	@claude plugin marketplace update cc-visualq >/dev/null
	@claude plugin uninstall cc-visualq@cc-visualq 2>/dev/null || true
	@claude plugin install cc-visualq@cc-visualq
	@claude plugin list | grep -A3 'cc-visualq@'

uninstall: dev-uninstall uninstall-plugin

dev-uninstall:
	@node scripts/dev-hooks.js remove

uninstall-plugin:
	@claude plugin uninstall cc-visualq@cc-visualq 2>/dev/null || true
