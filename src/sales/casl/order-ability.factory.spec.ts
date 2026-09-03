import { subject } from '@casl/ability';
import { Action, OrderAbilityFactory } from './order-ability.factory';
import { UserRole } from '../../../generated/prisma/client';

function buildUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-1',
    email: 'user@example.com',
    passwordHash: 'hash',
    firstName: 'Test',
    lastName: 'User',
    role: UserRole.CLIENT,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function order(overrides: Partial<Record<string, unknown>> = {}) {
  return subject('Order', {
    userId: 'user-1',
    deliveryPersonId: null,
    ...overrides,
  });
}

describe('OrderAbilityFactory', () => {
  const factory = new OrderAbilityFactory();

  describe('MANAGER', () => {
    it('manages every order regardless of ownership', () => {
      const ability = factory.createForUser(
        buildUser({ role: UserRole.MANAGER }),
      );

      expect(ability.can(Action.Read, order({ userId: 'someone-else' }))).toBe(
        true,
      );
      expect(
        ability.can(Action.Update, order({ userId: 'someone-else' })),
      ).toBe(true);
      expect(
        ability.can(Action.Cancel, order({ userId: 'someone-else' })),
      ).toBe(true);
      expect(ability.can(Action.Create, 'Order')).toBe(true);
    });

    it('passes a bare subject-type check with no instance at all', () => {
      const ability = factory.createForUser(
        buildUser({ role: UserRole.MANAGER }),
      );

      expect(ability.can(Action.Read, 'Order')).toBe(true);
      expect(ability.can(Action.Cancel, 'Order')).toBe(true);
    });
  });

  describe('CLIENT', () => {
    const user = buildUser({ id: 'client-1', role: UserRole.CLIENT });

    it('can create orders', () => {
      const ability = factory.createForUser(user);
      expect(ability.can(Action.Create, 'Order')).toBe(true);
    });

    it('can read and cancel only their own orders', () => {
      const ability = factory.createForUser(user);

      expect(ability.can(Action.Read, order({ userId: 'client-1' }))).toBe(
        true,
      );
      expect(ability.can(Action.Cancel, order({ userId: 'client-1' }))).toBe(
        true,
      );
      expect(ability.can(Action.Read, order({ userId: 'someone-else' }))).toBe(
        false,
      );
      expect(
        ability.can(Action.Cancel, order({ userId: 'someone-else' })),
      ).toBe(false);
    });

    it('can never update an order status', () => {
      const ability = factory.createForUser(user);
      expect(ability.can(Action.Update, order({ userId: 'client-1' }))).toBe(
        false,
      );
    });

    it('cannot manage orders at all', () => {
      const ability = factory.createForUser(user);
      expect(ability.cannot(Action.Manage, 'Order')).toBe(true);
    });
  });

  describe('DELIVERY', () => {
    const user = buildUser({ id: 'delivery-1', role: UserRole.DELIVERY });

    it('can read and update only orders assigned to them', () => {
      const ability = factory.createForUser(user);

      expect(
        ability.can(
          Action.Read,
          order({ userId: 'client-1', deliveryPersonId: 'delivery-1' }),
        ),
      ).toBe(true);
      expect(
        ability.can(
          Action.Update,
          order({ userId: 'client-1', deliveryPersonId: 'delivery-1' }),
        ),
      ).toBe(true);
      expect(
        ability.can(
          Action.Read,
          order({ userId: 'client-1', deliveryPersonId: 'someone-else' }),
        ),
      ).toBe(false);
      expect(
        ability.can(
          Action.Update,
          order({ userId: 'client-1', deliveryPersonId: 'someone-else' }),
        ),
      ).toBe(false);
    });

    it('can never cancel an order', () => {
      const ability = factory.createForUser(user);
      expect(
        ability.can(
          Action.Cancel,
          order({ userId: 'client-1', deliveryPersonId: 'delivery-1' }),
        ),
      ).toBe(false);
    });

    it('cannot create orders', () => {
      const ability = factory.createForUser(user);
      expect(ability.can(Action.Create, 'Order')).toBe(false);
    });
  });
});
