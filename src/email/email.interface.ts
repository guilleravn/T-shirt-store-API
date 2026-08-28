export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

// Used as both a TypeScript interface and a Nest DI token, so callers depend on this
// abstraction, never on which concrete implementation is bound to it (see BrevoEmailService).
export abstract class EmailService {
  abstract send(message: EmailMessage): Promise<void>;
}
