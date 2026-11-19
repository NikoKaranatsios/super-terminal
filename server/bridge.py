#!/usr/bin/env python3
"""Scoped tasks/mailbox and isolated browser. Task commands: create, report, list, flush."""
import argparse
import base64
import fcntl
import json
import os
import pathlib
import sys
import urllib.request
import urllib.error
import urllib.parse
import uuid
import time


def atomic_json(destination, value):
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = destination.with_name(destination.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        fd = os.open(str(temp), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as output:
            json.dump(value, output, ensure_ascii=False)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temp, destination)
    finally:
        if temp.exists():
            temp.unlink()


def request(config, payload):
    if config.get('transport') == 'stdio-spool':
        root = pathlib.Path('/workspace/bridge')
        if config.get('spool') != str(root):
            raise ValueError('Invalid runtime transport.')
        request_id = str(uuid.uuid4())
        request_file = root / 'requests' / request_id
        response_file = root / 'responses' / request_id
        atomic_json(request_file, payload)
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            if response_file.exists():
                result = json.loads(response_file.read_text())
                response_file.unlink()
                if isinstance(result, dict) and result.get('error'):
                    raise ValueError(result['error'])
                return result
            time.sleep(.1)
        raise ValueError('Control service unavailable or request still pending. Reuse the same helper request ID after reconnecting.')
    url = urllib.parse.urlsplit(config['url'])
    if url.scheme != 'http' or url.hostname not in ('127.0.0.1', 'localhost') or url.username or url.password or url.path not in ('', '/') or url.query or url.fragment:
        raise ValueError('The platform connection must use local loopback HTTP.')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            raise ValueError('Platform redirects are not allowed.')
    req = urllib.request.Request(config['url'] + '/api/agent', data=json.dumps(payload).encode(),
        headers={'Content-Type': 'application/json', 'X-Super-Terminal-Agent': config['token'], 'Host': config['hostHeader'],
                 'X-Super-Terminal-Transport': 'mcp' if os.environ.get('SUPER_TERMINAL_TRANSPORT') == 'mcp' else 'helper'})
    with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(req, timeout=120 if payload.get('command') == 'delegate' else 45 if payload.get('command') == 'browser' else 15) as response:
        return json.load(response)


def brief(result):
    if 'task' not in result:
        return result
    task = result['task']
    return {**{k: v for k, v in result.items() if k != 'task'},
            'task': {k: task[k] for k in ('id', 'title', 'status', 'revision', 'projectId', 'parentTaskId', 'agentId') if k in task}}


def deliver(config_path, config, payload=None, local_action=None, event_id=None):
    """Persist before sending; retries keep event IDs, sequence and original grant."""
    journal = config_path.with_name(config_path.stem + '.outbox.json')
    lock = journal.with_suffix('.lock')
    fd = os.open(str(lock), os.O_WRONLY | os.O_CREAT, 0o600)
    with os.fdopen(fd, 'w') as held:
        fcntl.flock(held, fcntl.LOCK_EX)
        state = json.loads(journal.read_text()) if journal.exists() else {'sequence': 0, 'pending': [], 'receipts': []}
        if local_action == 'pending':
            return {'pending': [r['payload'] for r in state['pending']]}
        if local_action == 'discard':
            found = next((r for r in state['pending'] if r['payload']['eventId'] == event_id), None)
            if not found:
                raise ValueError('Pending event not found. Use task pending to inspect queued events.')
            state['pending'].remove(found)
            atomic_json(journal, state)
            return {'discarded': event_id, 'pending': len(state['pending'])}
        wanted = None
        if payload is not None:
            # Explicit event IDs/client keys identify a logical operation even across CLI invocations.
            logical_key = payload.get('clientKey') or payload.get('eventId')
            prior = next((r for r in state['pending'] + state['receipts']
                          if logical_key and (r['payload'].get('clientKey') or r['payload'].get('eventId')) == logical_key
                          and r['payload'].get('assignmentRevision') == payload.get('assignmentRevision')
                          and r['payload'].get('attemptId') == payload.get('attemptId')), None)
            if prior:
                previous = {k: v for k, v in prior['payload'].items() if k not in ('sequence', 'eventId')}
                current = {k: v for k, v in payload.items() if k not in ('sequence', 'eventId')}
                if previous != current:
                    raise ValueError('This event ID or client key already identifies different content.')
                wanted = prior['payload']['eventId']
                if 'result' in prior:
                    return {**prior['result'], 'duplicate': True}
            else:
                supplied = payload.get('sequence')
                if supplied is not None and supplied <= state['sequence']:
                    raise ValueError('Sequence must exceed the last local sequence; retry with the same event ID.')
                state['sequence'] = supplied or state['sequence'] + 1
                payload['sequence'] = state['sequence']
                payload['eventId'] = payload.get('eventId') or str(uuid.uuid4())
                wanted = payload['eventId']
                state['pending'].append({'payload': payload})
                atomic_json(journal, state)
        results = []
        wanted_result = None
        while state['pending'] and len(results) < 10:
            operation = state['pending'][0]
            try:
                result = brief(request(config, operation['payload']))
            except Exception as error:
                # Never print credentials, request URLs or arbitrary provider bodies.
                detail = error_detail(error)
                print(json.dumps({'queued': True, 'eventId': wanted or operation['payload']['eventId'],
                                  'pending': len(state['pending']), 'error': detail,
                                  'next': 'Use task flush to retry. After reassignment: context, task pending, then task discard --event-id ID only for obsolete events.'}), file=sys.stderr)
                return None
            state['pending'].pop(0)
            operation['result'] = result
            state['receipts'] = (state['receipts'] + [operation])[-200:]
            atomic_json(journal, state)
            results.append(result)
            if operation['payload']['eventId'] == wanted:
                wanted_result = result
        if wanted and wanted_result is None:
            print(json.dumps({'queued': True, 'eventId': wanted, 'pending': len(state['pending']), 'next': 'Use task flush to continue the bounded batch.'}), file=sys.stderr)
            return None
        return wanted_result if wanted else {'flushed': len(results), 'pending': len(state['pending']), 'results': results[-10:]}


def error_detail(error):
    if isinstance(error, urllib.error.HTTPError):
        try:
            detail = json.loads(error.read(4096)).get('error', '')
        except Exception:
            detail = ''
        return 'HTTP ' + str(error.code) + (': ' + detail[:1500] if isinstance(detail, str) else '')
    return type(error).__name__


def rpc(config_path, config):
    """MCP machine entry point; uses the same locked, durable task/message journal."""
    raw = sys.stdin.read(262145)
    if len(raw) > 262144:
        raise ValueError('Request too large.')
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError('Request must be an object.')
    command = payload.get('command')
    if command in ('pending', 'discard', 'flush'):
        result = deliver(config_path, config, local_action=command if command != 'flush' else None, event_id=payload.get('eventId'))
    elif command in ('task', 'send'):
        payload.setdefault('attemptId', config.get('attemptId', config['id']))
        payload.setdefault('assignmentRevision', config.get('assignmentRevision', 0))
        result = deliver(config_path, config, payload)
    elif command in ('context', 'peers', 'inbox', 'ack', 'tasks', 'graph', 'heartbeat', 'conductor', 'delegate', 'browser'):
        if command == 'delegate':
            payload.setdefault('attemptId', config.get('attemptId', config['id']))
            payload.setdefault('assignmentRevision', config.get('assignmentRevision', 0))
        result = request(config, payload)
        if command == 'context':
            for key in ('attemptId', 'assignmentRevision', 'taskId'):
                if key in result:
                    config[key] = result[key]
            atomic_json(config_path, config)
    else:
        raise ValueError('Unknown MCP command.')
    if result is None:
        return 1
    print(json.dumps(result, ensure_ascii=False, separators=(',', ':')))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['rpc', 'peers', 'inbox', 'ack', 'send', 'context', 'progress', 'report', 'create', 'tasks', 'task', 'flush', 'browser'])
    parser.add_argument('action', nargs='?', help='task: create/report/list/flush/pending/discard; browser: open/snapshot/click/fill/press/scroll/screenshot/close')
    for flag in ('to', 'message-id', 'message', 'url', 'selector', 'text', 'key', 'goal', 'task', 'title', 'client-key', 'event-id', 'attempt-id', 'project-id', 'notes'):
        parser.add_argument('--' + flag)
    parser.add_argument('--sequence', type=int)
    parser.add_argument('--assignment-revision', type=int)
    parser.add_argument('--status', choices=['todo', 'doing', 'blocked', 'done', 'stopped'])
    parser.add_argument('--evidence', action='append', help='Verification summary; repeat for multiple items')
    args = parser.parse_args()
    config_path = pathlib.Path(os.environ['SUPER_TERMINAL_AGENT_CONFIG'])
    config = json.loads(config_path.read_text())
    if args.command == 'rpc':
        return rpc(config_path, config)
    command = args.action if args.command == 'task' else args.command
    if args.command == 'task' and command not in ('create', 'report', 'list', 'flush', 'pending', 'discard'):
        parser.error('task needs create, report, list, flush, pending, or discard')
    if command in ('create', 'report', 'progress'):
        if command == 'create' and (not args.title or not (args.client_key or args.event_id)):
            parser.error('create needs --title and a stable --client-key (or --event-id)')
        if args.sequence is not None and args.sequence < 1:
            parser.error('--sequence must be positive')
        payload = {'command': 'task', 'operation': 'create' if command == 'create' else 'report',
                   'attemptId': args.attempt_id or config.get('attemptId', config['id']),
                   'assignmentRevision': args.assignment_revision if args.assignment_revision is not None else config.get('assignmentRevision', 0)}
        fields = {'title': args.title, 'clientKey': args.client_key, 'eventId': args.event_id,
                  'sequence': args.sequence, 'status': args.status, 'notes': args.notes,
                  'evidence': args.evidence, 'projectId': args.project_id}
        if command != 'create':
            fields['taskId'] = args.task or args.goal or config.get('taskId')
        payload.update({key: value for key, value in fields.items() if value is not None})
        result = deliver(config_path, config, payload)
        if result is None:
            return 1
    elif command in ('pending', 'discard'):
        if command == 'discard' and not args.event_id:
            parser.error('discard needs --event-id; it abandons only that local queued report')
        result = deliver(config_path, config, local_action=command, event_id=args.event_id)
    elif command == 'flush':
        result = deliver(config_path, config)
        if result is None:
            return 1
    else:
        payload = {key: value for key, value in vars(args).items() if value is not None}
        if command in ('tasks', 'list'):
            payload = {'command': 'tasks'}
        result = request(config, payload)
        if command == 'context':
            metadata = result.get('agent', result)
            for key in ('attemptId', 'assignmentRevision', 'taskId'):
                if key in metadata:
                    config[key] = metadata[key]
                elif key in result:
                    config[key] = result[key]
            atomic_json(config_path, config)
    if 'image' in result:
        image = config_path.parent / 'screenshots' / (config['id'] + '.png')
        image.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd = os.open(str(image), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'wb') as output:
            output.write(base64.b64decode(result.pop('image')))
        result['screenshot'] = str(image)
    print(json.dumps(result, ensure_ascii=False, separators=(',', ':')))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except urllib.error.HTTPError as error:
        print('Platform request rejected: ' + error_detail(error), file=sys.stderr)
        sys.exit(1)
    except Exception as error:
        # Exceptions from urllib can contain the request URL. Never print it.
        print(str(error) if isinstance(error, ValueError) else 'Platform helper failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
