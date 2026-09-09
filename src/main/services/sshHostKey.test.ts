import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  appendKnownHostLine,
  classifySshHostKeyFailure,
  parseSshKeyscanOutput,
  scanSshHostKey,
  sshKeyFingerprint,
  toSshHostKeyChallenge,
} from './sshHostKey';

describe('classifySshHostKeyFailure', () => {
  it('未知主机与密钥变更分开，其它 stderr 不是 host key', () => {
    expect(classifySshHostKeyFailure('Host key verification failed.')).toBe('untrusted');
    expect(
      classifySshHostKeyFailure(
        'WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!\nHost key verification failed.'
      )
    ).toBe('changed');
    expect(classifySshHostKeyFailure('Permission denied (publickey)')).toBeNull();
  });
});

describe('parseSshKeyscanOutput / sshKeyFingerprint', () => {
  it('跳过注释，优先 ed25519，OpenSSH SHA256 指纹无填充', () => {
    const ed = Buffer.from('ed25519-public');
    const rsa = Buffer.from('rsa-public-key-bytes');
    const stdout = [
      '# comment',
      `example.com ssh-rsa ${rsa.toString('base64')}`,
      `example.com ssh-ed25519 ${ed.toString('base64')}`,
      '',
    ].join('\n');
    const parsed = parseSshKeyscanOutput(stdout);
    expect(parsed).toEqual({
      hostToken: 'example.com',
      keyType: 'ssh-ed25519',
      key: ed.toString('base64'),
      line: `example.com ssh-ed25519 ${ed.toString('base64')}`,
    });
    expect(sshKeyFingerprint(ed.toString('base64'))).toBe(
      `SHA256:${createHash('sha256').update(ed).digest('base64').replace(/=+$/, '')}`
    );
  });

  it('无 ed25519 时退到下一种；脏输出返回 null', () => {
    expect(
      parseSshKeyscanOutput(`box ecdsa-sha2-nistp256 ${Buffer.from('ec').toString('base64')}`)
        ?.keyType
    ).toBe('ecdsa-sha2-nistp256');
    expect(parseSshKeyscanOutput('# only\n\n')).toBeNull();
  });

  it('toSshHostKeyChallenge 不含 known_hosts 整行', () => {
    const challenge = toSshHostKeyChallenge({
      host: 'box',
      port: 2222,
      hostToken: 'box',
      keyType: 'ssh-ed25519',
      key: 'AAAA',
      line: 'box ssh-ed25519 AAAA',
    });
    expect(challenge).toEqual({
      host: 'box',
      port: 2222,
      keyType: 'ssh-ed25519',
      fingerprint: sshKeyFingerprint('AAAA'),
    });
    expect(JSON.stringify(challenge)).not.toContain('box ssh-ed25519');
  });
});

describe('scanSshHostKey', () => {
  it('非 22 端口带 -p，解析 stdout', async () => {
    let captured: string[] = [];
    const parsed = await scanSshHostKey('box', 2222, async (_file, args) => {
      captured = args;
      return { stdout: 'box ssh-ed25519 AAAA' };
    });
    expect(captured).toEqual(['-T', '10', '-p', '2222', 'box']);
    expect(parsed?.keyType).toBe('ssh-ed25519');
  });
});

describe('appendKnownHostLine', () => {
  it('创建目录并追加；相同密钥不重复写', () => {
    const dir = path.join(tmpdir(), `enso-known-hosts-${Date.now()}`);
    const file = path.join(dir, '.ssh', 'known_hosts');
    const line = 'dev.example ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest';
    expect(appendKnownHostLine(file, line)).toBe(true);
    expect(appendKnownHostLine(file, line)).toBe(false);
    mkdirSync(dir, { recursive: true });
    expect(readFileSync(file, 'utf8').trim().split('\n')).toEqual([line]);
  });

  it('已有其它行时只追加，保留原文', () => {
    const file = path.join(tmpdir(), `enso-known-hosts-keep-${Date.now()}`, 'known_hosts');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'old.example ssh-rsa AAAAold\n');
    const line = 'new.example ssh-ed25519 AAAAnew';
    expect(appendKnownHostLine(file, line)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(
      'old.example ssh-rsa AAAAold\nnew.example ssh-ed25519 AAAAnew\n'
    );
  });
});
