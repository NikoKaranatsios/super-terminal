import test from 'node:test';
import assert from 'node:assert/strict';
import { consoleText, conductorTurnMarkup, traceMarkup, traceTone } from '../src/console-format.mjs';
import { terminalTheme } from '../src/terminal-theme.mjs';
import { webLink } from '../shared/web-links.cjs';

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
  assert.match(html,/<h1 class="console-heading">Ready<\/h1>/);
  assert.match(html,/<strong>Verified<\/strong> <em>carefully<\/em> using <code>npm test<\/code>/);
  assert.match(html,/<code>&lt;img&gt; \*\*literal\*\*\n<\/code><\/pre><\/div>\n<p>Done<\/p>/);
  assert.equal(consoleText('**literal**'),'**literal**');
  assert.match(consoleText('```\nunfinished',{markdown:true}),/unfinished<\/code><\/pre>/);
  assert.match(conductorTurnMarkup({prompt:'**user text**',answer:'**complete**',status:'complete'}),/\*\*user text\*\*.*<strong>complete<\/strong>/s);
});

test('Markdown supports nested lists, task lists, quotes, tables, escaping and highlight marks', () => {
  const html=consoleText('## Summary\n\n- **Done**\n  - Nested\n- [x] Checked\n- [ ] Pending\n\n> ==Review needed==\n\n| Item | State |\n| --- | --- |\n| Build | done |\n\n1. First\n2. Second\n\n~~old~~ and \\*literal\\*\n\nRule\n---',{markdown:true});
  assert.match(html,/<li><strong>Done<\/strong>\n<ul>\n<li>Nested/);
  assert.match(html,/<input[^>]*checked=""[^>]*disabled=""[^>]*>/);
  assert.match(html,/<blockquote>\n<p><mark>Review needed<\/mark>/);
  assert.match(html,/<table>.*<th>Item<\/th>.*<td>done<\/td>/s);
  assert.match(html,/<ol>\n<li>First<\/li>\n<li>Second/);
  assert.match(html,/<s>old<\/s> and \*literal\*/);
  assert.match(html,/<h2 class="console-heading">Rule<\/h2>/);
});

test('Markdown highlights named languages and preserves unknown, oversized or ANSI code literally', () => {
  const html=consoleText('```json\n{"ready": true, "count": 2}\n```',{markdown:true});
  assert.match(html,/class="hljs-attr"/);assert.match(html,/class="hljs-literal"/);assert.match(html,/class="hljs-number"/);
  assert.match(consoleText('```unknown\n**literal** ==literal== <script>\n```',{markdown:true}),/\*\*literal\*\* ==literal== &lt;script&gt;/);
  assert.match(consoleText('```sh\n\x1b[32mgreen\x1b[0m\n```',{markdown:true}),/style="color:#96d9a9">green/);
  const large=consoleText('```js\n'+('x'.repeat(50001))+'\n```',{markdown:true});
  assert.doesNotMatch(large,/hljs-/);assert.match(large,/x{50001}/);
});

test('Markdown cannot introduce active HTML, remote images or unsafe URL schemes', () => {
  const html=consoleText('[safe](https://example.com/docs "Docs") [bad](javascript:alert%281%29) [file](file:///tmp/example) [entity](jav&#x61;script:alert%281%29)\n\n![Example](https://example.com/image.png)\n\n<img src=x onerror=alert(1)>\n<script>bad()</script>\n\n==<svg onload=bad>==',{markdown:true});
  assert.match(html,/<a href="https:\/\/example.com\/docs" title="Docs" target="_blank" rel="noopener noreferrer">safe/);
  assert.doesNotMatch(html,/<(?:img|script|svg)\b|href="(?:javascript|file|data):/);
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
  for(const url of ['javascript:alert(1)','file:///tmp/example','data:text/html,x','mailto:a@example.com','//example.com','https://user:secret@example.com','https://example.com\n/path','/local/path'])assert.equal(webLink(url),null);
  assert.equal(webLink('https://example.com/docs'),'https://example.com/docs');
});

test('structured model replies remain expandable while ordinary commentary stays visible', () => {
  const raw=JSON.stringify({answer:'**Checked.**',actions:[],assessments:[]});
  const html=traceMarkup({name:'agent_message',type:'item.completed',text:raw});
  assert.match(html,/<details class="line trace-line console-meta console-payload" data-trace-id=/);
  assert.match(html,/&quot;answer&quot;:&quot;\*\*Checked\.\*\*&quot;/);
  assert.doesNotMatch(html,/<details[^>]*\bopen/);
  assert.match(traceMarkup({name:'agent_message',text:'**Checking** the project.'}),/<strong>Checking<\/strong>/);
  assert.doesNotMatch(traceMarkup({name:'agent_message',text:'{"count":2}'}),/<details/);
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
