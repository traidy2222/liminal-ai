class OpenRouterCatalogModel {
  static bool isRouterId(String model) => RegExp(r'^openrouter/(?:auto(?:-[^:]+)?|free|fusion|bodybuilder|pareto-[^:]+)(?::.*)?$', caseSensitive: false).hasMatch(model.trim());
  OpenRouterCatalogModel(
      {required this.id,
      required this.name,
      this.contextLength = 0,
      this.supportsTools = false,
      this.vision = false,
      this.isRouter = false});
  final String id, name;
  final int contextLength;
  final bool supportsTools, vision, isRouter;
  factory OpenRouterCatalogModel.fromJson(Map<String, dynamic> json) =>
      OpenRouterCatalogModel(
        id: json['id'] as String,
        name: json['name'] as String? ?? json['id'] as String,
        contextLength: (json['contextLength'] as num?)?.toInt() ?? 0,
        supportsTools: json['supportsTools'] == true,
        vision: (json['inputModalities'] as List? ?? []).contains('image'),
        isRouter: json['isRouter'] == true,
      );
}
