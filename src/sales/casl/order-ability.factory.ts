import { Injectable } from '@nestjs/common';
import {
  AbilityBuilder,
  createMongoAbility,
  ForcedSubject,
  MongoAbility,
  subject,
} from '@casl/ability';
import { User, UserRole } from '../../../generated/prisma/client';

export enum Action {
  Manage = 'manage',
  Create = 'create',
  Read = 'read',
  Update = 'update',
  Cancel = 'cancel',
}

// `ForcedSubject<'Order'>` is what tells CASL's type system "an instance of this shape is
// checked against the bare-string subject type 'Order'" — without it, a plain (non-class)
// object can't carry typed conditions, and `can(action, 'Order', { userId: ... })` fails to
// compile because CASL has no way to know `userId` is a valid field for that subject.
export interface OrderSubject extends ForcedSubject<'Order'> {
  userId: string;
  deliveryPersonId: string | null;
}

// The union of the bare string (for type-only checks like `ability.can(Action.Create, 'Order')`)
// and the tagged interface (for instance checks via CASL's `subject('Order', order)` helper) —
// no `detectSubjectType` is configured, since there's no class to infer a constructor from.
export type AppAbility = MongoAbility<[Action, 'Order' | OrderSubject]>;

// The one and only way to check an ability against a real order row. Without CASL's `subject()`
// tag, a plain object's default-detected type doesn't match the 'Order' rules at all — every
// check silently returns false, MANAGER's `manage all` included — so this wrapper is what
// OrdersService reaches for instead of a raw cast that could skip the tag by mistake.
export function orderSubject(order: {
  userId: string;
  deliveryPersonId: string | null;
}): OrderSubject {
  return subject('Order', order);
}

@Injectable()
export class OrderAbilityFactory {
  createForUser(user: User): AppAbility {
    const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

    switch (user.role) {
      case UserRole.MANAGER:
        can(Action.Manage, 'Order');
        break;
      case UserRole.CLIENT:
        can(Action.Create, 'Order');
        can(Action.Read, 'Order', { userId: user.id });
        can(Action.Cancel, 'Order', { userId: user.id });
        break;
      case UserRole.DELIVERY:
        can(Action.Read, 'Order', { deliveryPersonId: user.id });
        can(Action.Update, 'Order', { deliveryPersonId: user.id });
        break;
      default: {
        // Compile-time guarantee: a 4th UserRole must get an explicit ability decision here,
        // not silently fall through to an empty (fail-closed) ability.
        const exhaustiveCheck: never = user.role;
        return exhaustiveCheck;
      }
    }

    return build();
  }
}
