import { Viewer, LabelCollection, Color, Cartesian2, LabelStyle, NearFarScalar, HeightReference, Entity, Cartesian3, PolygonGraphics, PolylineGraphics } from 'cesium';
import { MouseTooltip } from '@cesium-extends/tooltip';
import Drawer, { DrawOption } from '@cesium-extends/drawer';
import { Units } from '@turf/helpers';

type MeasureUnits = Units;
type MeasureLocaleOptions = {
    start: string;
    total: string;
    area: string;
    /**
     * 格式化显示长度
     * @param length 单位米
     * @param unit 目标单位
     */
    formatLength(length: number, unitedLength: number, unit: MeasureUnits): string;
    /**
     * 格式化显示面积
     * @param area 单位米
     * @param unit 目标单位
     */
    formatArea(area: number, unitedArea: number, unit: MeasureUnits): string;
};
type MeasureOptions = {
    labelStyle?: {
        font?: string;
        fillColor?: Color;
        backgroundColor?: Color;
        backgroundPadding?: Cartesian2;
        outlineWidth?: number;
        style?: LabelStyle;
        pixelOffset?: Cartesian2;
        scale?: number;
        scaleByDistance?: NearFarScalar;
        heightReference?: HeightReference;
    };
    /** defaults to kilometers */
    units?: MeasureUnits;
    onEnd?: (entity: Entity) => void;
    drawerOptions?: Partial<DrawOption>;
    /**
     * @example
     * {
          start: '起点',
          area: '面积',
          total: '总计',
          formatLength: (length, unitedLength) => {
            if (length < 1000) {
              return length + '米';
            }
            return unitedLength + '千米';
          },
          formatArea: (area, unitedArea) => {
            if (area < 1000000) {
              return area + '平方米';
            }
            return unitedArea + '平方千米';
          }
        }
     */
    locale?: Partial<MeasureLocaleOptions>;
};
type Status = 'INIT' | 'WORKING' | 'DESTROY';
declare class Measure {
    protected _viewer: Viewer;
    protected _status: Status;
    protected _labels: LabelCollection;
    protected _labelStyle: MeasureOptions['labelStyle'];
    protected _units: MeasureUnits;
    protected _locale: MeasureLocaleOptions;
    mouseTooltip: MouseTooltip;
    drawer: Drawer;
    private _onEnd;
    /**
     * 量算工具
     * @param viewer
     * @param {MeasureOptions['locale']} [options.locale] 绘制时的提示信息
     */
    constructor(viewer: Viewer, options?: MeasureOptions);
    /**
     * @return {boolean} 返回量算工具是否已销毁
     */
    get destroyed(): boolean;
    /**
     * 根据传入的坐标信息更新标签
     * @param {Cartesian3[]} positions
     */
    protected _updateLabelFunc(positions: Cartesian3[]): void;
    protected _cartesian2Lonlat(positions: Cartesian3[]): number[][];
    start(): void;
    /**
     * 开始绘制
     * @param {string} type 绘制图形类型
     * @param {boolean} clampToGround 是否贴地
     */
    protected _start(type: 'POLYGON' | 'POLYLINE' | 'POINT' | 'CIRCLE' | 'RECTANGLE', options?: {
        style?: object;
        clampToGround?: boolean;
    }): void;
    /**
     * 清除测量结果,重置绘制
     */
    end(): void;
    destroy(): void;
}

/**
 * 距离测量类
 */
declare class AreaMeasure extends Measure {
    protected _updateLabelFunc(positions: Cartesian3[]): void;
    /**
     * 计算多边形面积
     * @param {Cartesian3[]} positions 点位
     * @returns {number} 面积/平方米
     */
    getArea(positions: Cartesian3[]): number;
    protected _updateLabelTexts(positions: Cartesian3[]): void;
    protected _getDistance(pos1: Cartesian3, pos2: Cartesian3): number;
    start(style?: PolygonGraphics.ConstructorOptions): void;
}

/**
 * 贴地面积量算类
 */
declare class AreaSurfaceMeasure extends AreaMeasure {
    private _splitNum;
    /**
     * 贴地面积量算构造函数
     * @param viewer
     * @param [options.splitNum = 10] 插值数，将面分割的网格数, 默认为10
     */
    constructor(viewer: Viewer, options?: MeasureOptions & {
        splitNum?: number;
    });
    private _calculateSurfaceArea;
    private calculateDetailSurfaceArea;
    private _getWorldPositionsArea;
    private _Cartesian2turfPolygon;
    private _intersect;
    private _turfPloygon2CartesianArr;
    /**
     * 计算贴地的多边形面积
     * @param {Cartesian3[]} positions 点位
     * @returns {number} 面积/平方米
     */
    getArea(positions: Cartesian3[]): number;
}

/**
 * 距离测量类
 */
declare class DistanceMeasure extends Measure {
    protected _updateLabelFunc(positions: Cartesian3[]): void;
    /**
     * 计算两点之间的距离
     * @param {Cartesian3} start 点位1
     * @param {Cartesian3} end 点位2
     * @returns {number} 距离/米
     */
    getDistance(start: Cartesian3, end: Cartesian3): number;
    getCart3AxisDistance(start: Cartesian3, end: Cartesian3): Cartesian3;
    protected _updateLabelTexts(positions: Cartesian3[]): void;
    start(style?: PolylineGraphics.ConstructorOptions): void;
}

/**
 * 贴地距离测量类
 */
declare class DistanceSurfaceMeasure extends DistanceMeasure {
    private _splitNum;
    constructor(viewer: Viewer, options?: MeasureOptions & {
        splitNum?: number;
    });
    /**
     * 计算线段的表面距离
     * @param startPoint  -线段起点的屏幕坐标
     * @param endPoint    -线段终点的屏幕坐标
     * @returns 表面距离
     */
    private _calculateSurfaceDistance;
    /**
     * 计算细分后的，每一小段的笛卡尔坐标距离（也就是大地坐标系距离）
     * @param startPoint -每一段线段起点
     * @param endPoint -每一段线段终点
     * @returns 表面距离
     */
    private _calculateDetailSurfaceLength;
    /**
     * 获取线段上距起点一定距离出的线上点坐标（屏幕坐标）
     * @param startPosition  -线段起点（屏幕坐标）
     * @param endPosition -线段终点（屏幕坐标）
     * @param interval -距起点距离
     * @returns -结果坐标（屏幕坐标）
     */
    private _findWindowPositionByPixelInterval;
    getDistance(pos1: Cartesian3, pos2: Cartesian3): number;
    start(style?: PolylineGraphics.ConstructorOptions): void;
}

export { AreaMeasure, AreaSurfaceMeasure, DistanceMeasure, DistanceSurfaceMeasure, Measure };
