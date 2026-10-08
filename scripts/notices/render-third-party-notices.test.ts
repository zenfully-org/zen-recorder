// @vitest-environment node
/**
 * The notices file the extension ships: which packages it bundles, under which licence, each
 * licence's text, and where the source of a library under the MPL is. Its bytes depend only on
 * the packages, so two builds of the same sources ship the same file.
 */
import { type PackageNotice, renderThirdPartyNotices } from './render-third-party-notices';

const notice = (change: Partial<PackageNotice> = {}): PackageNotice => ({
  name: 'alpha',
  version: '1.0.0',
  licence: 'MIT',
  licenceText: { text: 'MIT License\n\nCopyright (c) Alpha authors', from: 'package' },
  source: undefined,
  ...change,
});

const project = { name: 'Zen Recorder', version: '0.4.0' };

describe('renderThirdPartyNotices', () => {
  it('lists the packages, then gives each its licence text', () => {
    expect(
      renderThirdPartyNotices(project, [
        notice({
          name: '@scope/beta',
          version: '2.1.0',
          licence: 'ISC',
          licenceText: { text: 'ISC License', from: 'package' },
        }),
        notice(),
      ]),
    ).toBe(
      [
        '# Third-party notices',
        '',
        'Zen Recorder 0.4.0 is under the MIT licence, in the file LICENSE next to this one. It bundles the 2 open-source packages below, which keep their own licences. Each one’s licence text follows the list.',
        '',
        '| Package | Version | Licence |',
        '| --- | --- | --- |',
        '| @scope/beta | 2.1.0 | ISC |',
        '| alpha | 1.0.0 | MIT |',
        '',
        '## @scope/beta 2.1.0',
        '',
        'Licence: ISC.',
        '',
        '```text',
        'ISC License',
        '```',
        '',
        '## alpha 1.0.0',
        '',
        'Licence: MIT.',
        '',
        '```text',
        'MIT License',
        '',
        'Copyright (c) Alpha authors',
        '```',
        '',
      ].join('\n'),
    );
  });

  it('says where the source of a library under the MPL is', () => {
    const notices = renderThirdPartyNotices(project, [
      notice({
        name: 'mediabunny',
        version: '1.55.5',
        licence: 'MPL-2.0',
        source: 'https://github.com/Vanilagy/mediabunny',
      }),
    ]);

    expect(notices).toContain(
      [
        '## mediabunny 1.55.5',
        '',
        'Licence: MPL-2.0. Its source code is at https://github.com/Vanilagy/mediabunny (version 1.55.5).',
      ].join('\n'),
    );
  });

  it('says when the licence text comes from the package’s repository', () => {
    const notices = renderThirdPartyNotices(project, [
      notice({ licenceText: { text: 'MIT License', from: 'project' } }),
    ]);

    expect(notices).toContain(
      'Licence: MIT. The npm package publishes no licence file; this is the one in its repository.',
    );
  });

  it('fences a licence text with more backticks than any run inside it', () => {
    const notices = renderThirdPartyNotices(project, [
      notice({ licenceText: { text: 'Use ```code``` and ````more````.', from: 'package' } }),
    ]);

    expect(notices).toContain('`````text\nUse ```code``` and ````more````.\n`````\n');
  });

  it('orders packages by name, then version, whatever order they come in', () => {
    const notices = renderThirdPartyNotices(project, [
      notice({ name: 'beta', version: '2.0.0' }),
      notice({ name: 'beta', version: '10.0.0' }),
      notice({ name: 'alpha' }),
    ]);

    expect(notices.match(/^## .*$/gm)).toEqual([
      '## alpha 1.0.0',
      '## beta 2.0.0',
      '## beta 10.0.0',
    ]);
  });
});
