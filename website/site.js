const examples = {
  codex: {name: 'Codex', role: 'implementation', prompt: 'Add keyboard navigation to the command menu.', intro: 'I’ll check the menu and its existing tests.', files: ['src/command-menu.ts', 'tests/command-menu.test.ts'], result: 'Added focus movement and Escape to close.', note: 'The targeted keyboard tests pass.'},
  claude: {name: 'Claude', role: 'code review', prompt: 'Review the command menu changes.', intro: 'The keyboard handlers have test coverage.', files: ['src/command-menu.ts', 'tests/command-menu.test.ts'], result: 'One thing to check: where focus returns after closing.', note: 'An in-app check is still needed.'},
  grok: {name: 'Grok', role: 'exploration', prompt: 'Explore the existing command menu structure.', intro: 'I found the menu and its keyboard tests.', files: ['src/command-menu.ts', 'tests/command-menu.test.ts'], result: 'Selection and filtering share the same menu state.', note: 'The implementation can stay in the existing component.'},
};
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(selected, focus = false) {
  tabs.forEach(tab => {
    const active = tab === selected;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
  });
  if (focus) selected.focus();
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', event => {
    const destination = {ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1}[event.key];
    if (destination === undefined) return;
    event.preventDefault();
    selectTab(tabs[destination], true);
  });
});
document.querySelectorAll('[data-agent]').forEach(button => {
  button.addEventListener('click', () => {
    const example = examples[button.dataset.agent];
    document.querySelectorAll('[data-agent]').forEach(item => {
      item.classList.toggle('selected', item === button);
      item.setAttribute('aria-pressed', String(item === button));
    });
    document.getElementById('provider-name').textContent = example.name;
    document.querySelector('#panel-terminal .terminal-session > span:last-child').textContent = `orbit / ${example.role}`;
    document.getElementById('example-prompt').textContent = example.prompt;
    const response = document.getElementById('example-response');
    response.replaceChildren();
    function line(tag, text, className) {
      const node = document.createElement(tag);
      node.textContent = text;
      if (className) node.className = className;
      response.append(node);
    }
    line('p', example.intro);
    example.files.forEach(file => line('div', `│  ${file}`, 'file-line'));
    line('p', example.result, 'terminal-result');
    line('p', example.note, 'terminal-muted');
    selectTab(tabs[0]);
  });
});
const copyButton = document.getElementById('copy-install');
if (navigator.clipboard?.writeText) {
  copyButton.hidden = false;
  copyButton.addEventListener('click', async () => {
    const status = document.getElementById('copy-status');
    try {
      await navigator.clipboard.writeText(document.getElementById('install-commands').textContent.trim());
      copyButton.textContent = 'Copied';
      status.textContent = 'Installation commands copied to the clipboard.';
      setTimeout(() => { copyButton.textContent = 'Copy commands'; }, 2500);
    } catch {
      status.textContent = 'Copy was unavailable. Select and copy the commands below.';
      copyButton.textContent = 'Select commands below';
    }
  });
}
