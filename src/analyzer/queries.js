/**
 * queries.js — per-language tree-sitter queries for symbol extraction.
 *
 * Each language provides capture names using a shared vocabulary so the extractor
 * is language-agnostic:
 *   @fn.def / @fn.name       function/method definition + its name
 *   @class.def / @class.name class/struct/interface/enum/trait definition + name
 *   @import                  an import/require/use statement (whole node)
 *   @import.source           the module string, when isolable
 *   @call.name               a call expression callee name
 *   @method.def/@method.name method inside a class
 *
 * Missing constructs are simply omitted; the extractor tolerates nulls. Queries
 * are intentionally conservative (correctness over completeness).
 */

export const QUERIES = {
  typescript: {
    functions: `
      (function_declaration name: (identifier) @fn.name) @fn.def
      (method_definition name: (property_identifier) @fn.name) @fn.def
      (variable_declarator name: (identifier) @fn.name value: (arrow_function)) @fn.def
      (variable_declarator name: (identifier) @fn.name value: (function_expression)) @fn.def
      (public_field_definition name: (property_identifier) @fn.name value: (arrow_function)) @fn.def
    `,
    classes: `
      (class_declaration name: (type_identifier) @class.name) @class.def
      (interface_declaration name: (type_identifier) @class.name) @class.def
      (enum_declaration name: (identifier) @class.name) @class.def
      (type_alias_declaration name: (type_identifier) @class.name) @class.def
    `,
    imports: `
      (import_statement source: (string) @import.source) @import
      (call_expression function: (identifier) @_r arguments: (arguments (string) @import.source) (#eq? @_r "require")) @import
    `,
    calls: `(call_expression function: (identifier) @call.name)
            (call_expression function: (member_expression property: (property_identifier) @call.name))`,
  },
  javascript: {
    functions: `
      (function_declaration name: (identifier) @fn.name) @fn.def
      (method_definition name: (property_identifier) @fn.name) @fn.def
      (variable_declarator name: (identifier) @fn.name value: (arrow_function)) @fn.def
      (variable_declarator name: (identifier) @fn.name value: (function_expression)) @fn.def
    `,
    classes: `(class_declaration name: (identifier) @class.name) @class.def`,
    imports: `
      (import_statement source: (string) @import.source) @import
      (call_expression function: (identifier) @_r arguments: (arguments (string) @import.source) (#eq? @_r "require")) @import
    `,
    calls: `(call_expression function: (identifier) @call.name)
            (call_expression function: (member_expression property: (property_identifier) @call.name))`,
  },
  python: {
    functions: `(function_definition name: (identifier) @fn.name) @fn.def`,
    classes: `(class_definition name: (identifier) @class.name) @class.def`,
    imports: `
      (import_statement) @import
      (import_from_statement) @import
    `,
    calls: `(call function: (identifier) @call.name)
            (call function: (attribute attribute: (identifier) @call.name))`,
  },
  java: {
    functions: `(method_declaration name: (identifier) @fn.name) @fn.def
                (constructor_declaration name: (identifier) @fn.name) @fn.def`,
    classes: `
      (class_declaration name: (identifier) @class.name) @class.def
      (interface_declaration name: (identifier) @class.name) @class.def
      (enum_declaration name: (identifier) @class.name) @class.def
      (record_declaration name: (identifier) @class.name) @class.def
    `,
    imports: `(import_declaration (scoped_identifier) @import.source) @import`,
    calls: `(method_invocation name: (identifier) @call.name)`,
  },
  kotlin: {
    functions: `(function_declaration (simple_identifier) @fn.name) @fn.def`,
    classes: `(class_declaration (type_identifier) @class.name) @class.def
              (object_declaration (type_identifier) @class.name) @class.def`,
    imports: `(import_header (identifier) @import.source) @import`,
    calls: `(call_expression (simple_identifier) @call.name)`,
  },
  go: {
    functions: `(function_declaration name: (identifier) @fn.name) @fn.def
                (method_declaration name: (field_identifier) @fn.name) @fn.def`,
    classes: `(type_declaration (type_spec name: (type_identifier) @class.name)) @class.def`,
    imports: `(import_spec path: (interpreted_string_literal) @import.source) @import
              (import_declaration) @import`,
    calls: `(call_expression function: (identifier) @call.name)
            (call_expression function: (selector_expression field: (field_identifier) @call.name))`,
  },
  rust: {
    functions: `(function_item name: (identifier) @fn.name) @fn.def`,
    classes: `
      (struct_item name: (type_identifier) @class.name) @class.def
      (enum_item name: (type_identifier) @class.name) @class.def
      (trait_item name: (type_identifier) @class.name) @class.def
      (impl_item type: (type_identifier) @class.name) @class.def
    `,
    imports: `(use_declaration) @import`,
    calls: `(call_expression function: (identifier) @call.name)
            (call_expression function: (field_expression field: (field_identifier) @call.name))
            (call_expression function: (scoped_identifier name: (identifier) @call.name))`,
  },
  csharp: {
    functions: `(method_declaration name: (identifier) @fn.name) @fn.def
                (constructor_declaration name: (identifier) @fn.name) @fn.def
                (local_function_statement name: (identifier) @fn.name) @fn.def`,
    classes: `
      (class_declaration name: (identifier) @class.name) @class.def
      (interface_declaration name: (identifier) @class.name) @class.def
      (struct_declaration name: (identifier) @class.name) @class.def
      (enum_declaration name: (identifier) @class.name) @class.def
      (record_declaration name: (identifier) @class.name) @class.def
    `,
    imports: `(using_directive) @import`,
    calls: `(invocation_expression function: (identifier) @call.name)
            (invocation_expression function: (member_access_expression name: (identifier) @call.name))`,
  },
  php: {
    functions: `(function_definition name: (name) @fn.name) @fn.def
                (method_declaration name: (name) @fn.name) @fn.def`,
    classes: `
      (class_declaration name: (name) @class.name) @class.def
      (interface_declaration name: (name) @class.name) @class.def
      (trait_declaration name: (name) @class.name) @class.def
      (enum_declaration name: (name) @class.name) @class.def
    `,
    imports: `(namespace_use_declaration) @import`,
    calls: `(function_call_expression function: (name) @call.name)
            (member_call_expression name: (name) @call.name)
            (scoped_call_expression name: (name) @call.name)`,
  },
  ruby: {
    functions: `(method name: (identifier) @fn.name) @fn.def
                (singleton_method name: (identifier) @fn.name) @fn.def`,
    classes: `(class name: (constant) @class.name) @class.def
              (module name: (constant) @class.name) @class.def`,
    imports: `(call method: (identifier) @_r (#match? @_r "require|require_relative|load") arguments: (argument_list (string) @import.source)) @import`,
    calls: `(call method: (identifier) @call.name)`,
  },
  c: {
    functions: `(function_definition declarator: (function_declarator declarator: (identifier) @fn.name)) @fn.def`,
    classes: `(struct_specifier name: (type_identifier) @class.name) @class.def
              (enum_specifier name: (type_identifier) @class.name) @class.def
              (union_specifier name: (type_identifier) @class.name) @class.def`,
    imports: `(preproc_include) @import`,
    calls: `(call_expression function: (identifier) @call.name)`,
  },
  cpp: {
    functions: `(function_definition declarator: (function_declarator declarator: (identifier) @fn.name)) @fn.def
                (function_definition declarator: (function_declarator declarator: (field_identifier) @fn.name)) @fn.def`,
    classes: `
      (class_specifier name: (type_identifier) @class.name) @class.def
      (struct_specifier name: (type_identifier) @class.name) @class.def
      (enum_specifier name: (type_identifier) @class.name) @class.def
    `,
    imports: `(preproc_include) @import`,
    calls: `(call_expression function: (identifier) @call.name)
            (call_expression function: (field_expression field: (field_identifier) @call.name))`,
  },
  swift: {
    functions: `(function_declaration (simple_identifier) @fn.name) @fn.def`,
    classes: `(class_declaration name: (type_identifier) @class.name) @class.def
              (protocol_declaration name: (type_identifier) @class.name) @class.def`,
    imports: `(import_declaration) @import`,
    calls: `(call_expression (simple_identifier) @call.name)`,
  },
  dart: {
    functions: `(function_signature name: (identifier) @fn.name) @fn.def
                (method_signature) @fn.def`,
    classes: `(class_definition name: (identifier) @class.name) @class.def
              (enum_declaration name: (identifier) @class.name) @class.def`,
    imports: `(import_specification (configurable_uri (uri (string_literal) @import.source))) @import
              (import_or_export) @import`,
    calls: `(identifier) @call.name`,
  },
  scala: {
    functions: `(function_definition name: (identifier) @fn.name) @fn.def`,
    classes: `
      (class_definition name: (identifier) @class.name) @class.def
      (object_definition name: (identifier) @class.name) @class.def
      (trait_definition name: (identifier) @class.name) @class.def
    `,
    imports: `(import_declaration) @import`,
    calls: `(call_expression function: (identifier) @call.name)`,
  },
  lua: {
    functions: `(function_declaration name: (identifier) @fn.name) @fn.def
                (function_declaration name: (dot_index_expression field: (identifier) @fn.name)) @fn.def`,
    classes: ``,
    imports: `(function_call name: (identifier) @_r (#eq? @_r "require") arguments: (arguments (string) @import.source)) @import`,
    calls: `(function_call name: (identifier) @call.name)`,
  },
  elixir: {
    functions: `(call target: (identifier) @_d (#match? @_d "def|defp") (arguments (call target: (identifier) @fn.name))) @fn.def`,
    classes: `(call target: (identifier) @_d (#match? @_d "defmodule") (arguments (alias) @class.name)) @class.def`,
    imports: `(call target: (identifier) @_i (#match? @_i "import|alias|use|require")) @import`,
    calls: `(call target: (identifier) @call.name)`,
  },
  solidity: {
    functions: `(function_definition name: (identifier) @fn.name) @fn.def`,
    classes: `(contract_declaration name: (identifier) @class.name) @class.def
              (interface_declaration name: (identifier) @class.name) @class.def
              (library_declaration name: (identifier) @class.name) @class.def`,
    imports: `(import_directive) @import`,
    calls: `(call_expression function: (identifier) @call.name)`,
  },
  bash: {
    functions: `(function_definition name: (word) @fn.name) @fn.def`,
    classes: ``,
    imports: ``,
    calls: `(command name: (command_name) @call.name)`,
  },
};

// tsx/jsx reuse ts/js queries
QUERIES.tsx = QUERIES.typescript;
