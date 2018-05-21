const map = require('lodash/map');
const Entity = require('./Entity');
const Field = require('./Field');
const FullyQualifiedType = require('./FullyQualifiedType');

class Model extends Entity {
  /**
   * Create a model.
   * @param {Object} schema - An object representing an API builder model definition.
   * @param {FullyQualifiedType} fullyQualifiedType
   * @param {Service} service
   */
  constructor(schema, fullyQualifiedType, service) {
    super(fullyQualifiedType, service);
    this.schema = schema;

    Object.defineProperty(this, 'fields', {
      get() {
        return map(this.schema.fields, field => Field.fromSchema(field, service));
      },
    });
  }
}
/**
 * Returns the Model corresponding to the specified API builder model definition.
 * @param {Object} model An object representing an API Builder model definition.
 * @param {Service} service
 * @param {String} [namespace = service.namespace]
 * @returns {FullyQualifiedType}
 */
Model.fromSchema = function fromSchema(schema, service, namespace = service.namespace) {
  const fullyQualifiedType = new FullyQualifiedType(`${namespace}.models.${schema.name}`);
  return new Model(schema, fullyQualifiedType, service);
};

module.exports = Model;
