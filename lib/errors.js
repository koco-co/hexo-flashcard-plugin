'use strict';

class FlashcardValidationError extends Error {
  constructor({ source = '<unknown>', cardId = '<unknown>', field = 'card', reason }) {
    super(`[hexo-flashcard-plugin] ${source} card ${cardId} field ${field}: ${reason}`);
    this.name = 'FlashcardValidationError';
    this.source = source;
    this.cardId = cardId;
    this.field = field;
  }
}

function fail(context, field, reason) {
  throw new FlashcardValidationError({
    source: context.source,
    cardId: context.cardId,
    field,
    reason
  });
}

module.exports = {
  FlashcardValidationError,
  fail
};
