import type { MeetingEventBody, ParticipantRef } from '@/lib/types';

const anonymous = (ref: ParticipantRef): ParticipantRef => ({ ...ref, name: null });
const anonymousOrNull = (ref: ParticipantRef | null) => (ref === null ? null : anonymous(ref));

/**
 * `body` without the names of the people it refers to, for notes kept without names: ids, the
 * user, counts and states stay, so the notes still tell what happened and when.
 */
export function withoutParticipantNames(body: MeetingEventBody): MeetingEventBody {
  switch (body.type) {
    case 'roster':
      return {
        ...body,
        participants: body.participants.map(anonymous),
        shareBy: anonymousOrNull(body.shareBy),
      };
    case 'participant-joined':
    case 'participant-left':
      return { ...body, participant: anonymousOrNull(body.participant) };
    case 'participant-renamed':
      return { ...body, participant: anonymous(body.participant), from: null };
    default:
      return body;
  }
}
