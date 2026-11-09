import { z } from '@enterprise/contracts';

export const errorResponse = {
  description: 'Request rejected',
  content: {
    'application/json': {
      schema: z.object({
        code: z.number(),
        message: z.string(),
        data: z.unknown(),
      }),
    },
  },
};
