import test from 'node:test';
import assert from 'node:assert/strict';
import { consoleText, conductorTurnMarkup, traceMarkup, traceTone } from '../src/console-format.mjs';
import { terminalTheme } from '../src/terminal-theme.mjs';

test('console preserves normal/bright ANSI colors, emphasis and selective resets', () => {
  const html = consoleText('\x1b[31;1mred\x1b[22m normal\x1b[91m bright\x1b[0m plain\n\x1b[2;3;4;9mdetails\x1b[23;24;29m dim\x1b[22m reset');
  assert.match(html,new RegExp(`class="ansi-bold" style="color:${terminalTheme.red}">red`));
  assert.match(html,new RegExp(`style="color:${terminalTheme.brightRed}"> bright`));
  assert.match(html,/> normal<\/span>/);
  assert.match(html,/<\/span> plain\n/);
  assert.match(html,/class="ansi-dim ansi-italic ansi-underline ansi-strike">details/);
  assert.match(html,/class="ansi-dim"> dim<\/span> reset$/);
  for(let i=0;i<8;i++) {
    assert.match(consoleText(`\x1b[${30+i}mcolor`),/style="color:#[\da-f]{6}"/);
    assert.match(consoleText(`\x1b[${90+i}mcolor`),/style="color:#[\da-f]{6}"/);
  }
});

test('console accepts indexed and RGB colors and ignores invalid color values', () => {
  assert.match(consoleText('\x1b[38;5;196;48;2;12;34;56mcolor'),/color:rgb\(255,0,0\);background-color:rgb\(12,34,56\)/);
  assert.match(consoleText('\x1b[38;5;244mgray'),/color:rgb\(128,128,128\)/);
  assert.equal(consoleText('\x1b[38;2;999;0;0mplain'),'plain');
  assert.equal(consoleText('\x1b[38;5;999mplain'),'plain');
  assert.match(consoleText('\x1b[7minverse\x1b[27m normal'),/background-color:#d8dfda.*inverse<\/span> normal$/);
});

test('console escapes markup and strips terminal side-effect controls', () => {
  const html = consoleText('\x1b]8;;javascript:alert(1)\x07link\x1b]8;;\x07\x1b[2J<img src=x onerror="alert(1)"><script>bad</script>');
  assert.equal(html,'link&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&lt;script&gt;bad&lt;/script&gt;');
  assert.equal(consoleText('\x1b]52;c;clipboard\x1b\\safe'),'safe');
  assert.doesNotMatch(traceMarkup({kind:'<img src=x>',name:'<script>',text:'<svg onload=bad>'}),/<(?:img|script|svg)/);
});

test('Conductor prose gets terminal emphasis while commands and fenced code stay literal', () => {
  const html = consoleText('# Ready\n**Verified** *carefully* using `npm test`\n```js\n<img> **literal**\n```\nDone',{markdown:true});
  assert.match(html,/<strong class="console-heading">Ready<\/strong>/);
  assert.match(html,/<strong>Verified<\/strong> <em>carefully<\/em> using <code>npm test<\/code>/);
  assert.match(html,/<code>&lt;img&gt; \*\*literal\*\*\n<\/code><\/pre>Done/);
  assert.equal(consoleText('**literal**'),'**literal**');
  assert.match(consoleText('```\nunfinished',{markdown:true}),/unfinished<\/code><\/pre>$/);
  assert.match(conductorTurnMarkup({prompt:'**user text**',answer:'**complete**',status:'complete'}),/\*\*user text\*\*.*<strong>complete<\/strong>/s);
});

test('event types and failures have distinct semantic tones without hiding output', () => {
  assert.equal(traceTone({type:'item.completed',name:'command_execution',exitCode:1}),'error');
  assert.equal(traceTone({kind:'tool_result',result:{partial:true}}),'warning');
  assert.equal(traceTone({kind:'skill',name:'Example skill'}),'skill');
  assert.equal(traceTone({type:'item.completed',name:'command_execution',exitCode:0}),'tool');
  assert.equal(traceTone({kind:'tool_result'}),'result');
  assert.equal(traceTone({kind:'commentary'}),'commentary');
  assert.equal(traceTone({type:'turn.completed'}),'success');
  const html=traceMarkup({type:'item.completed',name:'command_execution',command:'npm test',output:'Everything passed',exitCode:0});
  assert.match(html,/console-command/); assert.match(html,/npm test/); assert.match(html,/Everything passed/); assert.match(html,/exit 0/);
});
