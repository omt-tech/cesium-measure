import { HeightReference, NearFarScalar, Cartesian2, LabelStyle, Color, LabelCollection, Math as Math$1, Cartesian3, EllipsoidGeodesic, Cartographic, SceneTransforms } from 'cesium';
import { polygon, convertArea, convertLength } from '@turf/helpers';
import { MouseTooltip } from '@cesium-extends/tooltip';
import Drawer from '@cesium-extends/drawer';
import area from '@turf/area';
import intersect from '@turf/intersect';
import { randomPoint } from '@turf/random';
import voronoi from '@turf/voronoi';

function pickCartesian3(viewer, position) {
  return viewer.scene.pickPosition(position);
}
function getBounds(points) {
  const left = Math.min(...points.map((item) => item.x));
  const right = Math.max(...points.map((item) => item.x));
  const top = Math.max(...points.map((item) => item.y));
  const bottom = Math.min(...points.map((item) => item.y));
  const bounds = [left, top, right, bottom];
  return bounds;
}
function formatLength(length, unitedLength, unit) {
  if (length < 1e3) {
    return length + "meters";
  }
  return unitedLength + unit;
}
function formatArea(area, unitedArea, unit) {
  if (area < 1e6) {
    return area + " square meters ";
  }
  return unitedArea + " square " + unit;
}
function mean(array) {
  return array.reduce((accumulator, currentValue) => accumulator + currentValue, 0) / array.length;
}

const DefaultOptions = {
  labelStyle: {
    font: `bold 20px Arial`,
    fillColor: Color.WHITE,
    backgroundColor: new Color(0.165, 0.165, 0.165, 0.8),
    backgroundPadding: new Cartesian2(4, 4),
    outlineWidth: 4,
    style: LabelStyle.FILL_AND_OUTLINE,
    pixelOffset: new Cartesian2(4, 0),
    scale: 1,
    scaleByDistance: new NearFarScalar(1, 0.85, 8e6, 0.75),
    heightReference: HeightReference.CLAMP_TO_GROUND
  }
};
class Measure {
  _viewer;
  _status;
  _labels;
  _labelStyle;
  _units;
  _locale;
  mouseTooltip;
  drawer;
  _onEnd;
  /**
   * 量算工具
   * @param viewer
   * @param {MeasureOptions['locale']} [options.locale] 绘制时的提示信息
   */
  constructor(viewer, options = {}) {
    if (!viewer) throw new Error("undefined viewer");
    this._viewer = viewer;
    this._labelStyle = {
      ...DefaultOptions.labelStyle,
      ...options.labelStyle
    };
    this._units = options.units ?? "kilometers";
    this._onEnd = options.onEnd;
    this._locale = {
      area: "Area",
      start: "start",
      total: "Total",
      formatLength,
      formatArea,
      ...options.locale
    };
    this.mouseTooltip = new MouseTooltip(viewer);
    this.mouseTooltip.hide();
    this.drawer = new Drawer(viewer, {
      sameStyle: true,
      terrain: true,
      ...options.drawerOptions
    });
    this._labels = new LabelCollection({
      scene: this._viewer.scene
    });
    this._viewer.scene.primitives.add(this._labels);
    this._status = "INIT";
  }
  /**
   * @return {boolean} 返回量算工具是否已销毁
   */
  get destroyed() {
    return this._status === "DESTROY";
  }
  /**
   * 根据传入的坐标信息更新标签
   * @param {Cartesian3[]} positions
   */
  _updateLabelFunc(positions) {
  }
  _cartesian2Lonlat(positions) {
    return positions.map((pos) => {
      const cartographic = this._viewer.scene.globe.ellipsoid.cartesianToCartographic(pos);
      const lon = +Math$1.toDegrees(cartographic.longitude);
      const lat = +Math$1.toDegrees(cartographic.latitude);
      return [lon, lat];
    });
  }
  start() {
  }
  /**
   * 开始绘制
   * @param {string} type 绘制图形类型
   * @param {boolean} clampToGround 是否贴地
   */
  _start(type, options) {
    const { style, clampToGround } = options ?? {};
    if (this._status !== "INIT") return;
    const self = this;
    this.drawer.start({
      type,
      onPointsChange: self._updateLabelFunc.bind(self),
      dynamicOptions: {
        ...style,
        clampToGround
      },
      finalOptions: {
        ...style,
        clampToGround
      },
      onEnd: this._onEnd
    });
    this._status = "WORKING";
  }
  /**
   * 清除测量结果,重置绘制
   */
  end() {
    this.drawer.reset();
    this._labels.removeAll();
    this._status = "INIT";
  }
  destroy() {
    this.end();
    this.mouseTooltip.destroy();
    if (this._viewer && !this._viewer.isDestroyed()) {
      this._viewer.scene.primitives.remove(this._labels);
    }
    this._status = "DESTROY";
  }
}

class AreaMeasure extends Measure {
  _updateLabelFunc(positions) {
    this._labels.removeAll();
    if (positions.length < 3) return;
    const position = new Cartesian3(
      ...["x", "y", "z"].map(
        (key) => mean(positions.map((item) => item[key]))
      )
    );
    this._labels.add({
      position,
      ...this._labelStyle,
      pixelOffset: new Cartesian2(-100, 0)
    });
    this._updateLabelTexts(positions);
  }
  /**
   * 计算多边形面积
   * @param {Cartesian3[]} positions 点位
   * @returns {number} 面积/平方米
   */
  getArea(positions) {
    const lonlats = this._cartesian2Lonlat(positions);
    const pg = polygon([[...lonlats, lonlats[0]]]);
    const polygonArea = area(pg);
    return polygonArea;
  }
  _updateLabelTexts(positions) {
    const label = this._labels.get(0);
    const area2 = +this.getArea(positions).toFixed(2);
    const unitedArea = +convertArea(area2, "meters", this._units).toFixed(2);
    label.text = `${this._locale.area}: ${this._locale.formatArea(
      area2,
      unitedArea,
      this._units
    )}`;
  }
  _getDistance(pos1, pos2) {
    return Cartesian3.distance(pos1, pos2);
  }
  start(style = {}) {
    this.end();
    this._start("POLYGON", {
      style
    });
  }
}

class AreaSurfaceMeasure extends AreaMeasure {
  _splitNum;
  /**
   * 贴地面积量算构造函数
   * @param viewer
   * @param [options.splitNum = 10] 插值数，将面分割的网格数, 默认为10
   */
  constructor(viewer, options = {}) {
    super(viewer, options);
    this._splitNum = options.splitNum ?? 10;
  }
  _calculateSurfaceArea(positions) {
    let result = 0;
    const bounds = getBounds(positions);
    const points = randomPoint(this._splitNum, {
      bbox: [bounds[0], bounds[1], bounds[2], bounds[3]]
    });
    const mainPoly = this._Cartesian2turfPolygon(positions);
    const voronoiPolygons = voronoi(points, {
      bbox: [bounds[0], bounds[1], bounds[2], bounds[3]]
    });
    voronoiPolygons.features.forEach((element) => {
      const intersectPoints = this._intersect(mainPoly, element.geometry);
      result += this.calculateDetailSurfaceArea(intersectPoints);
    });
    return result;
  }
  calculateDetailSurfaceArea(positions) {
    const worldPositions = [];
    positions.forEach((element) => {
      const pickResult = pickCartesian3(this._viewer, element);
      if (pickResult) worldPositions.push(pickResult);
    });
    const area = this._getWorldPositionsArea(worldPositions);
    return area;
  }
  _getWorldPositionsArea(positions) {
    const x = [0];
    const y = [0];
    const geodesic = new EllipsoidGeodesic();
    const radiansPerDegree = Math.PI / 180;
    for (let i = 0; i < positions.length - 1; i += 1) {
      const p1 = positions[i];
      const p2 = positions[i + 1];
      const point1cartographic = Cartographic.fromCartesian(p1);
      const point2cartographic = Cartographic.fromCartesian(p2);
      geodesic.setEndPoints(point1cartographic, point2cartographic);
      const s = Math.sqrt(
        Math.pow(geodesic.surfaceDistance, 2) + Math.pow(point2cartographic.height - point1cartographic.height, 2)
      );
      const lat1 = point2cartographic.latitude * radiansPerDegree;
      const lon1 = point2cartographic.longitude * radiansPerDegree;
      const lat2 = point1cartographic.latitude * radiansPerDegree;
      const lon2 = point1cartographic.longitude * radiansPerDegree;
      let angle = -Math.atan2(
        Math.sin(lon1 - lon2) * Math.cos(lat2),
        Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon1 - lon2)
      );
      if (angle < 0) {
        angle += Math.PI * 2;
      }
      y.push(Math.sin(angle) * s + y[i]);
      x.push(Math.cos(angle) * s + x[i]);
    }
    let sum = 0;
    for (let i = 0; i < x.length - 1; i += 1) {
      sum += x[i] * y[i + 1] - x[i + 1] * y[i];
    }
    return Math.abs(sum + x[x.length - 1] * y[0] - x[0] * y[y.length - 1]) / 2;
  }
  _Cartesian2turfPolygon(positions) {
    const coordinates = [[]];
    positions.forEach((element) => {
      coordinates[0].push([element.x, element.y]);
    });
    coordinates[0].push([positions[0].x, positions[0].y]);
    const pg = polygon(coordinates);
    return pg.geometry;
  }
  _intersect(poly1, poly2) {
    const intersection = intersect(poly1, poly2);
    if ((intersection == null ? void 0 : intersection.geometry) !== void 0) {
      return this._turfPloygon2CartesianArr(intersection == null ? void 0 : intersection.geometry);
    } else {
      return [];
    }
  }
  _turfPloygon2CartesianArr(polygon2) {
    return polygon2.coordinates[0].map(
      (item) => new Cartesian2(item[0], item[1])
    );
  }
  /**
   * 计算贴地的多边形面积
   * @param {Cartesian3[]} positions 点位
   * @returns {number} 面积/平方米
   */
  getArea(positions) {
    return this._calculateSurfaceArea(
      positions.map(
        (item) => SceneTransforms.worldToWindowCoordinates(this._viewer.scene, item)
      )
    );
  }
}

class DistanceMeasure extends Measure {
  _updateLabelFunc(positions) {
    this._labels.removeAll();
    positions.forEach((position) => {
      const newLabel = {
        position,
        ...this._labelStyle
      };
      this._labels.add(newLabel);
    });
    this._updateLabelTexts(positions);
  }
  /**
   * 计算两点之间的距离
   * @param {Cartesian3} start 点位1
   * @param {Cartesian3} end 点位2
   * @returns {number} 距离/米
   */
  getDistance(start, end) {
    return Cartesian3.distance(start, end);
  }
  getCart3AxisDistance(start, end) {
    return new Cartesian3(start.x - end.x, start.y - end.y, start.z - end.z);
  }
  getCart3Height(start, end) {
    const startCartographic = Cartographic.fromCartesian(start);
    const endCartographic = Cartographic.fromCartesian(end);
    return Math.abs(startCartographic.height - endCartographic.height);
  }
  _updateLabelTexts(positions) {
    const num = positions.length;
    let distance = 0;
    let unitedAxisDis = [0, 0, 0];
    for (let i = 0; i < num; i += 1) {
      const label = this._labels.get(i);
      if (i === 0) {
        label.text = this._locale.start;
        continue;
      } else {
        const newDis = +this.getDistance(
          positions[i - 1],
          positions[i]
        ).toFixed(2);
        const unitedNewDis = +convertLength(
          newDis,
          "meters",
          this._units
        ).toFixed(2);
        const newAxisDis = this.getCart3AxisDistance(
          positions[i - 1],
          positions[i]
        );
        const height = this.getCart3Height(positions[i - 1], positions[i]);
        const unitedNewAxisDis = [newAxisDis.x, newAxisDis.y, newAxisDis.z].map(
          (value) => {
            const isNegative = value < 0;
            const converted = +convertLength(
              Math.abs(value),
              "meters",
              this._units
            ).toFixed(2);
            return isNegative ? -converted : converted;
          }
        );
        distance += newDis;
        distance = +distance.toFixed(2);
        const unitedDistance = +convertLength(
          distance,
          "meters",
          this._units
        ).toFixed(2);
        unitedAxisDis = unitedNewAxisDis.map((val, i2) => {
          return unitedAxisDis[i2] + val;
        });
        label.text = (i === num - 1 ? `${this._locale.total}: ` : "D: ") + this._locale.formatLength(distance, unitedDistance, this._units) + `
(Z: ${this._locale.formatLength(
          height,
          unitedAxisDis[2],
          this._units
        )})` + (i > 1 ? `
(+${this._locale.formatLength(
          newDis,
          unitedNewDis,
          this._units
        )})` : "");
      }
    }
  }
  start(style = {}) {
    this._start("POLYLINE", {
      style,
      clampToGround: false
    });
  }
}

class DistanceSurfaceMeasure extends DistanceMeasure {
  _splitNum;
  constructor(viewer, options = {}) {
    super(viewer, options);
    this._splitNum = options.splitNum ?? 100;
  }
  /**
   * 计算线段的表面距离
   * @param startPoint  -线段起点的屏幕坐标
   * @param endPoint    -线段终点的屏幕坐标
   * @returns 表面距离
   */
  _calculateSurfaceDistance(startPoint, endPoint) {
    let resultDistance = 0;
    const sampleWindowPoints = [startPoint];
    const interval = Math.sqrt(
      Math.pow(endPoint.x - startPoint.x, 2) + (endPoint.y - startPoint.y, 2)
    ) / this._splitNum;
    for (let ii = 1; ii <= this._splitNum; ii += 1) {
      const tempPositon = this._findWindowPositionByPixelInterval(
        startPoint,
        endPoint,
        ii * interval
      );
      sampleWindowPoints.push(tempPositon);
    }
    sampleWindowPoints.push(endPoint);
    for (let jj = 0; jj < sampleWindowPoints.length - 1; jj += 1) {
      resultDistance += this._calculateDetailSurfaceLength(
        sampleWindowPoints[jj + 1],
        sampleWindowPoints[jj]
      );
    }
    return resultDistance;
  }
  /**
   * 计算细分后的，每一小段的笛卡尔坐标距离（也就是大地坐标系距离）
   * @param startPoint -每一段线段起点
   * @param endPoint -每一段线段终点
   * @returns 表面距离
   */
  _calculateDetailSurfaceLength(startPoint, endPoint) {
    let innerS = 0;
    const surfaceStartCartesian3 = pickCartesian3(this._viewer, startPoint);
    const surfaceEndCartesian3 = pickCartesian3(this._viewer, endPoint);
    if (surfaceStartCartesian3 && surfaceEndCartesian3) {
      const cartographicStart = Cartographic.fromCartesian(
        surfaceStartCartesian3
      );
      const cartographicEnd = Cartographic.fromCartesian(surfaceEndCartesian3);
      const geoD = new EllipsoidGeodesic();
      geoD.setEndPoints(cartographicStart, cartographicEnd);
      innerS = geoD.surfaceDistance;
      innerS = Math.sqrt(
        Math.pow(innerS, 2) + Math.pow(cartographicStart.height - cartographicEnd.height, 2)
      );
    }
    return innerS;
  }
  /**
   * 获取线段上距起点一定距离出的线上点坐标（屏幕坐标）
   * @param startPosition  -线段起点（屏幕坐标）
   * @param endPosition -线段终点（屏幕坐标）
   * @param interval -距起点距离
   * @returns -结果坐标（屏幕坐标）
   */
  _findWindowPositionByPixelInterval(startPosition, endPosition, interval) {
    const result = new Cartesian2(0, 0);
    const length = Math.sqrt(
      Math.pow(endPosition.x - startPosition.x, 2) + Math.pow(endPosition.y - startPosition.y, 2)
    );
    if (length < interval) {
      return result;
    } else {
      const x = interval / length * (endPosition.x - startPosition.x) + startPosition.x;
      const y = interval / length * (endPosition.y - startPosition.y) + startPosition.y;
      result.x = x;
      result.y = y;
    }
    return result;
  }
  getDistance(pos1, pos2) {
    const start = SceneTransforms.worldToWindowCoordinates(
      this._viewer.scene,
      pos1
    );
    const end = SceneTransforms.worldToWindowCoordinates(
      this._viewer.scene,
      pos2
    );
    return this._calculateSurfaceDistance(start, end);
  }
  start(style = {}) {
    this._start("POLYLINE", {
      clampToGround: true,
      style
    });
  }
}

export { AreaMeasure, AreaSurfaceMeasure, DistanceMeasure, DistanceSurfaceMeasure, Measure };
