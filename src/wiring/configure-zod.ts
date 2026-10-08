/**
 * Puts zod in its interpreted mode, where it never builds code from a string. Every entrypoint
 * imports this module first, so it runs before any schema of its bundle is built.
 *
 * In its default mode zod asks the browser whether it may compile code (`new Function('')`) when
 * it builds its first object schema, and where it may, it compiles each object parser with
 * `new Function`. The hook scripts run in the meeting page's own world, under the page's Content
 * Security Policy. Where that policy forbids eval (Meet, Teams), the attempt raises a
 * `securitypolicyviolation` the page sees, and a report the policy sends to the service, even
 * though zod catches the error. Where it allows eval (Zoom), the compiled parsers run as code
 * built inside the page. The extension's own pages and its isolated content scripts forbid eval
 * too. The interpreted parsers do the same work.
 *
 * zod keeps its settings on `globalThis`, which in the hook scripts is the page's window: a zod
 * that the page bundles itself shares them.
 */
import { z } from 'zod';

z.config({ jitless: true });
