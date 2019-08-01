import {
  ApiBuilderArray,
  ApiBuilderEnum,
  ApiBuilderField,
  ApiBuilderModel,
  ApiBuilderService,
  ApiBuilderType,
  ApiBuilderUnion,
  isArrayType,
  isEnumType,
  isMapType,
  isModelType,
  isPrimitiveType,
  ApiBuilderMap,
  ApiBuilderPrimitiveType,
  Kind,
} from 'apibuilder-js';
import { builders as b, namedTypes } from 'ast-types';
import { camelCase, upperFirst } from 'lodash';
import { Context } from './types';
import { checkIdentifier } from '../utilities/language';

function pascalCase(
  value: string,
): string {
  return upperFirst(camelCase(value));
}

function safeIdentifier(
  identifier: string,
): string {
  const feedback = checkIdentifier(identifier);
  return feedback.es3Warning ? `RESERVED_WORD_${identifier}` : identifier;
}

function buildQualifiedName(
  identifiers: namedTypes.Identifier[],
): namedTypes.TSQualifiedName | namedTypes.Identifier {
  function recurse(
    left: namedTypes.Identifier[],
    right: namedTypes.TSQualifiedName | namedTypes.Identifier,
  ): namedTypes.TSQualifiedName | namedTypes.Identifier {
    if (!left.length) return right;
    return recurse(left, b.tsQualifiedName(left.pop(), right));
  }

  return recurse(identifiers, identifiers.pop());
}

function buildUnknownType(): namedTypes.TSUnknownKeyword {
  return b.tsUnknownKeyword();
}

function buildPrimitiveType(
  type: ApiBuilderPrimitiveType,
) {
  switch (type.shortName) {
  case Kind.STRING:
  case Kind.DATE_ISO8601:
  case Kind.DATE_TIME_ISO8601:
  case Kind.UUID:
  case Kind.JSON:
    return b.tsStringKeyword();
  case Kind.BOOLEAN:
    return b.tsBooleanKeyword();
  case Kind.DECIMAL:
  case Kind.DOUBLE:
  case Kind.INTEGER:
  case Kind.LONG:
    return b.tsNumberKeyword();
  case Kind.OBJECT:
    return b.tsTypeLiteral([
      b.tsIndexSignature(
        [b.identifier.from({
          name: 'key',
          typeAnnotation: b.tsTypeAnnotation(
            b.tsStringKeyword(),
          ),
        })],
        b.tsTypeAnnotation(
          b.tsStringKeyword(),
        ),
      ),
    ]);
  default:
    return buildUnknownType();
  }
}

function buildArrayType(
  array: ApiBuilderArray,
  context: Context,
): namedTypes.TSArrayType {
  return b.tsArrayType(buildType(array.ofType, context));
}

function buildMapType(
  map: ApiBuilderMap,
  context: Context,
): namedTypes.TSTypeLiteral {
  return b.tsTypeLiteral([
    b.tsIndexSignature([
      b.identifier.from({
        name: 'key',
        typeAnnotation: b.tsTypeAnnotation(b.tsStringKeyword()),
      }),
    ], buildTypeAnnotation(map.ofType, context)),
  ]);
}

function buildEnumType(
  enumeration: ApiBuilderEnum,
): namedTypes.TSUnionType {
  return b.tsUnionType(
    enumeration.values.map(value => b.tsLiteralType(
      b.stringLiteral(value.name),
    )),
  );
}

function buildModelType(
  model: ApiBuilderModel,
  context: Context
): namedTypes.TSTypeLiteral {
  return b.tsTypeLiteral(
    model.fields.map(field => buildFieldPropertySignature(field, context)),
  );
}

function buildUnionType(
  union: ApiBuilderUnion,
  context: Context,
): namedTypes.TSParenthesizedType {
  return b.tsParenthesizedType(
    b.tsUnionType(
      union.types.map((unionType) => {
        const discriminator = b.tsPropertySignature(
          b.identifier(union.discriminator),
          b.tsTypeAnnotation(
            b.tsLiteralType(
              b.stringLiteral(unionType.discriminatorValue),
            ),
          ),
        );

        if (isModelType(unionType.type)) {
          return b.tsIntersectionType([
            b.tsTypeLiteral([discriminator]),
            buildType(unionType.type, context),
          ]);
        }

        if (isEnumType(unionType.type)) {
          return b.tsTypeLiteral([
            discriminator,
            b.tsPropertySignature(
              b.identifier('value'),
              buildTypeAnnotation(unionType.type, context),
            ),
          ]);
        }

        if (isPrimitiveType(unionType.type)) {
          return b.tsTypeLiteral([
            discriminator,
            b.tsPropertySignature(
              b.identifier('value'),
              buildTypeAnnotation(unionType.type, context),
            ),
          ]);
        }

        // The provided union type refers to an invalid type.
        // An union type may only refer to an enum, model, or primitive type.
        return buildUnknownType();
      }),
    ),
  );
}

/**
 * Returns `Identifier` for the specified type. The identifier is formatted
 * in pascal case and illegal identifiers will be prefixed with `RESERVED_WORD`
 * to avoid runtime errors in a JavaScript environment.
 */
export function buildTypeIdentifier(
  type: ApiBuilderEnum | ApiBuilderModel | ApiBuilderUnion,
): namedTypes.Identifier {
  return b.identifier(
    safeIdentifier(pascalCase(type.shortName)),
  );
}

/**
 * Returns `TSQualifiedName` for the specified type. Illegal identifiers will be
 * prefixed with `RESERVED_WORD` to avoid runtime errors in a JavaScript
 * environment.
 */
export function buildTypeQualifiedName(
  type: ApiBuilderEnum | ApiBuilderModel | ApiBuilderUnion,
): namedTypes.Identifier | namedTypes.TSQualifiedName {
  const identifiers = type.packageName
    .split('.')
    .concat(pascalCase(type.shortName))
    .map(safeIdentifier)
    .map(b.identifier);
  return buildQualifiedName(identifiers);
}

/**
 * Returns `TSTypeReference` for the specified type.
 */
export function buildTypeReference(
  type: ApiBuilderEnum | ApiBuilderModel | ApiBuilderUnion
): namedTypes.TSTypeReference {
  return b.tsTypeReference(buildTypeQualifiedName(type));
}

function buildType(
  type: ApiBuilderType,
  context: Context,
) {
  if (isArrayType(type)) {
    return buildArrayType(type, context);
  }

  if (isMapType(type)) {
    return buildMapType(type, context);
  }

  if (isPrimitiveType(type)) {
    return buildPrimitiveType(type);
  }

  if (context.unresolvedTypes.includes(type.fullName)) {
    return buildUnknownType();
  }

  return buildTypeReference(type);
}

function buildTypeAnnotation(
  type: ApiBuilderType,
  context: Context,
): namedTypes.TSTypeAnnotation {
  return b.tsTypeAnnotation(
    buildType(type, context),
  );
}

function buildFieldPropertySignature(
  field: ApiBuilderField,
  context: Context,
) {
  return b.tsPropertySignature.from({
    key: b.stringLiteral(field.name),
    optional: !field.isRequired,
    readonly: true,
    typeAnnotation: buildTypeAnnotation(field.type, context),
  });
}

function buildEnumDeclaration(
  enumeration: ApiBuilderEnum
): namedTypes.TSTypeAliasDeclaration {
  return b.tsTypeAliasDeclaration(
    buildTypeIdentifier(enumeration),
    buildEnumType(enumeration),
  );
}

function buildModelDeclaration(
  model: ApiBuilderModel,
  context: Context,
): namedTypes.TSInterfaceDeclaration {
  return b.tsInterfaceDeclaration(
    buildTypeIdentifier(model),
    b.tsInterfaceBody(
      model.fields.map(field => buildFieldPropertySignature(field, context)),
    ),
  );
}

function buildUnionDeclaration(
  union: ApiBuilderUnion,
  context: Context,
): namedTypes.TSTypeAliasDeclaration {
  return b.tsTypeAliasDeclaration(
    buildTypeIdentifier(union),
    buildUnionType(union, context),
  );
}

function buildModuleIdentifiers(
  service: ApiBuilderService,
  type: 'enums' | 'models' | 'unions'
): namedTypes.Identifier[] {
  return service.namespace.split('.').map(safeIdentifier).concat([type]).map(b.identifier);
}

function buildModuleDeclaration(
  identifiers: namedTypes.Identifier[],
  declarations: namedTypes.ExportNamedDeclaration[],
): namedTypes.TSModuleDeclaration {
  function recurse(
    left: namedTypes.Identifier[],
    right: namedTypes.TSModuleDeclaration
  ): namedTypes.TSModuleDeclaration {
    if (!identifiers.length) return right;
    return recurse(left, b.tsModuleDeclaration(left.pop(), right));
  }

  return recurse(identifiers, b.tsModuleDeclaration(identifiers.pop(), b.tsModuleBlock(declarations)));
}

function buildEnumModuleDeclaration(
  service: ApiBuilderService,
): namedTypes.TSModuleDeclaration {
  const identifiers = buildModuleIdentifiers(service, 'enums');
  const declarations = service.enums
    .map(enumeration => buildEnumDeclaration(enumeration))
    .map(declaration => b.exportNamedDeclaration(declaration));
  return buildModuleDeclaration(identifiers, declarations);
}

function buildModelModuleDeclaration(
  service: ApiBuilderService,
  context: Context,
) {
  const identifiers = buildModuleIdentifiers(service, 'models');
  const declarations = service.models
    .map(model => buildModelDeclaration(model, context))
    .map(declaration => b.exportNamedDeclaration(declaration));
  return buildModuleDeclaration(identifiers, declarations);
}

function buildUnionModuleDeclaration(
  service: ApiBuilderService,
  context: Context,
) {
  const identifiers = buildModuleIdentifiers(service, 'unions');
  const declarations = service.unions
    .map(union => buildUnionDeclaration(union, context))
    .map(declaration => b.exportNamedDeclaration(declaration));
  return buildModuleDeclaration(identifiers, declarations);
}

export function buildModuleDeclarations(
  context: Context
): namedTypes.TSModuleDeclaration[] {
  const modules: namedTypes.TSModuleDeclaration[] = [];
  const services = context.importedServices.concat(context.rootService);
  services.forEach((service) => {
    if (service.enums.length) {
      modules.push(buildEnumModuleDeclaration(service));
    }

    if (service.models.length) {
      modules.push(buildModelModuleDeclaration(service, context));
    }

    if (service.unions.length) {
      modules.push(buildUnionModuleDeclaration(service, context));
    }
  });
  return modules;
}