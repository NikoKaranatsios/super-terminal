// One palette for live PTYs and the Conductor's saved output.
export const terminalTheme = {
  background:'#101214', foreground:'#d8dfda', cursor:'#96d9a9', cursorAccent:'#101214', selectionBackground:'#345143',
  black:'#171b1e', red:'#e78989', green:'#96d9a9', yellow:'#dfc68f', blue:'#90b5e3', magenta:'#c6a0d8', cyan:'#87c9c2', white:'#d8dfda',
  brightBlack:'#818b85', brightRed:'#f2a0a0', brightGreen:'#b0ecc0', brightYellow:'#f0d9a4', brightBlue:'#b0cef4', brightMagenta:'#dfb7ee', brightCyan:'#abe1da', brightWhite:'#f3f7f4'
};

export function applyTerminalPalette(element) {
  for (const [name, color] of Object.entries(terminalTheme)) element.style.setProperty(`--terminal-${name.replace(/[A-Z]/g, c => '-'+c.toLowerCase())}`, color);
}
