import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'isBigInt', async: false })
class IsBigIntConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'bigint';
  }

  defaultMessage(): string {
    return '$property must be a BigInt';
  }
}

export const IsBigInt = (options?: ValidationOptions): PropertyDecorator => {
  return (target, propertyKey) => {
    registerDecorator({
      target: target.constructor,
      propertyName: propertyKey as string,
      options,
      constraints: [],
      validator: IsBigIntConstraint,
    });
  };
};
