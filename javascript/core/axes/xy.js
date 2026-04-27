/*
    WebPlotDigitizer - web based chart data extraction software (and more)
    
    Copyright (C) 2025 Ankit Rohatgi

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/

var wpd = wpd || {};

wpd.XYAxes = (function() {
    var AxesObj = function() {
        var calibration, isCalibrated = false,
            isLogScaleX = false,
            isLogScaleY = false,
            isLogScaleXNegative = false,
            isLogScaleYNegative = false,
            isPiecewiseY = false,
            isPiecewiseX = false,

            isXDate = false,
            isYDate = false,
            noRotation = false,

            metadata = {},

            initialFormattingX, initialFormattingY,

            // piecewise Y state
            ymid_data = 0,
            y_axis_dx = 0,
            y_axis_dy = 0,
            y_axis_len_sq = 0,
            t2_piecewise = 0,

            // piecewise X state
            xmid_data = 0,
            x_axis_dx = 0,
            x_axis_dy = 0,
            x_axis_len_sq = 0,
            t2_piecewise_x = 0,

            x1, x2, x3, x4, y1, y2, y3, y4, xmin, xmax, ymin, ymax,
            a_mat = [0, 0, 0, 0],
            a_inv_mat = [0, 0, 0, 0],
            c_vec = [0, 0],

            processCalibration = function(cal, isLogX, isLogY, noRotationCorrection, isPiecewiseYFlag, isPiecewiseXFlag) {
                // Point layout: [X1(0), X2(1), Y1(2), Y2(3), (X3?)(4), (Y3?)(5)]
                // X3 is at index 4 when piecewise X; Y3 is at index 5 (or 4 if no piecewise X) when piecewise Y
                var minRequired = 4 + (isPiecewiseXFlag ? 1 : 0) + (isPiecewiseYFlag ? 1 : 0);
                if (cal.getCount() < minRequired) {
                    return false;
                }

                // Dynamic indices: X3 (if present) comes before Y1/Y2/Y3
                var cpX3Idx = isPiecewiseXFlag ? 2 : -1;
                var cpY1Idx = isPiecewiseXFlag ? 3 : 2;
                var cpY2Idx = isPiecewiseXFlag ? 4 : 3;
                var cpY3Idx = isPiecewiseYFlag ? (isPiecewiseXFlag ? 5 : 4) : -1;

                var cp1 = cal.getPoint(0);                                           // X1
                var cp_x2 = cal.getPoint(1);                                         // X2 (middle X if piecewise, else end X)
                var cp_x3 = cpX3Idx >= 0 ? cal.getPoint(cpX3Idx) : null;            // X3 (end X), only piecewise X
                var cp_y1 = cal.getPoint(cpY1Idx);                                  // Y1
                var cp_y2 = cal.getPoint(cpY2Idx);                                  // Y2 (middle Y if piecewise, else end Y)
                var cp_y3 = cpY3Idx >= 0 ? cal.getPoint(cpY3Idx) : null;            // Y3 (end Y), only piecewise Y

                var cpXLast = isPiecewiseXFlag ? cp_x3 : cp_x2;  // X-axis endpoint for matrix
                var cpYLast = isPiecewiseYFlag ? cp_y3 : cp_y2;  // Y-axis endpoint for matrix

                var ip = new wpd.InputParser(),
                    dat_mat, pix_mat;

                x1 = cp1.px;
                y1 = cp1.py;
                x2 = cpXLast.px;
                y2 = cpXLast.py;
                x3 = cp_y1.px;
                y3 = cp_y1.py;
                x4 = cpYLast.px;
                y4 = cpYLast.py;

                xmin = cp1.dx;
                xmax = cpXLast.dx;
                ymin = cp_y1.dy;
                ymax = cpYLast.dy;

                // Check for dates, validity etc.

                // Validate X-Axes:
                xmin = ip.parse(xmin);
                if (!ip.isValid) {
                    return false;
                }
                isXDate = ip.isDate;
                xmax = ip.parse(xmax);
                if (!ip.isValid || (ip.isDate != isXDate)) {
                    return false;
                }
                initialFormattingX = ip.formatting;

                // Validate Y-Axes:
                ymin = ip.parse(ymin);
                if (!ip.isValid) {
                    return false;
                }
                isYDate = ip.isDate;
                ymax = ip.parse(ymax);
                if (!ip.isValid || (ip.isDate != isYDate)) {
                    return false;
                }
                initialFormattingY = ip.formatting;

                isLogScaleX = isPiecewiseXFlag ? false : isLogX;
                isLogScaleY = isPiecewiseYFlag ? false : isLogY;
                isPiecewiseX = !!isPiecewiseXFlag;
                isPiecewiseY = !!isPiecewiseYFlag;
                noRotation = noRotationCorrection;

                // If x-axis is log scale
                if (isLogScaleX === true) {
                    if (xmin < 0 && xmax < 0) {
                        isLogScaleXNegative = true;
                        xmin = Math.log(-xmin) / Math.log(10);
                        xmax = Math.log(-xmax) / Math.log(10);
                    } else {
                        xmin = Math.log(xmin) / Math.log(10);
                        xmax = Math.log(xmax) / Math.log(10);
                    }
                }

                // If y-axis is log scale
                if (isLogScaleY === true) {
                    if (ymin < 0 && ymax < 0) {
                        isLogScaleYNegative = true;
                        ymin = Math.log(-ymin) / Math.log(10);
                        ymax = Math.log(-ymax) / Math.log(10);
                    } else {
                        ymin = Math.log(ymin) / Math.log(10);
                        ymax = Math.log(ymax) / Math.log(10);
                    }
                }

                // Piecewise X: validate X2 and compute parametric split point along X axis
                if (isPiecewiseX) {
                    xmid_data = ip.parse(cp_x2.dx);
                    if (!ip.isValid) return false;
                    x_axis_dx = cpXLast.px - cp1.px;
                    x_axis_dy = cpXLast.py - cp1.py;
                    x_axis_len_sq = x_axis_dx * x_axis_dx + x_axis_dy * x_axis_dy;
                    if (x_axis_len_sq === 0) return false;
                    t2_piecewise_x = ((cp_x2.px - cp1.px) * x_axis_dx + (cp_x2.py - cp1.py) * x_axis_dy) / x_axis_len_sq;
                }

                // Piecewise Y: validate Y2 and compute parametric split point along Y axis
                if (isPiecewiseY) {
                    ymid_data = ip.parse(cp_y2.dy);
                    if (!ip.isValid) return false;
                    y_axis_dx = cpYLast.px - cp_y1.px;
                    y_axis_dy = cpYLast.py - cp_y1.py;
                    y_axis_len_sq = y_axis_dx * y_axis_dx + y_axis_dy * y_axis_dy;
                    if (y_axis_len_sq === 0) return false;
                    t2_piecewise = ((cp_y2.px - cp_y1.px) * y_axis_dx + (cp_y2.py - cp_y1.py) * y_axis_dy) / y_axis_len_sq;
                }

                dat_mat = [xmin - xmax, 0, 0, ymin - ymax];
                pix_mat = [x1 - x2, x3 - x4, y1 - y2, y3 - y4];

                a_mat = wpd.mat.mult2x2(dat_mat, wpd.mat.inv2x2(pix_mat));

                if (noRotation) {
                    // avoid rotating the axes if this is selected.
                    if (Math.abs(a_mat[0] * a_mat[3]) > Math.abs(a_mat[1] * a_mat[2])) {
                        // snap to zero deg
                        a_mat[1] = 0;
                        a_mat[2] = 0;
                        a_mat[0] = (xmax - xmin) / (x2 - x1);
                        a_mat[3] = (ymax - ymin) / (y4 - y3);
                    } else {
                        // snap to +/- 90 deg since it appears x-axis is vertical and y is horizontal
                        a_mat[0] = 0;
                        a_mat[3] = 0;
                        a_mat[1] = (xmax - xmin) / (y2 - y1);
                        a_mat[2] = (ymax - ymin) / (x4 - x3);
                    }
                }

                a_inv_mat = wpd.mat.inv2x2(a_mat);
                c_vec[0] = xmin - a_mat[0] * x1 - a_mat[1] * y1;
                c_vec[1] = ymin - a_mat[2] * x3 - a_mat[3] * y3;

                calibration = cal;
                return true;
            };

        this.getBounds = function() {
            return {
                x1: isLogScaleX ? Math.pow(10, xmin) : xmin,
                x2: isLogScaleX ? Math.pow(10, xmax) : xmax,
                y3: isLogScaleY ? Math.pow(10, ymin) : ymin,
                y4: isLogScaleY ? Math.pow(10, ymax) : ymax
            };
        };

        this.isCalibrated = function() {
            return isCalibrated;
        };

        this.calibration = null;

        this.calibrate = function(calib, isLogX, isLogY, noRotationCorrection, isPiecewiseYFlag, isPiecewiseXFlag) {
            this.calibration = calib;
            isCalibrated = processCalibration(calib, isLogX, isLogY, noRotationCorrection, isPiecewiseYFlag, isPiecewiseXFlag);
            return isCalibrated;
        };

        this.pixelToData = function(pxi, pyi) {
            var data = [],
                xp, yp, xf, yf, dat_vec;

            xp = parseFloat(pxi);
            yp = parseFloat(pyi);

            dat_vec = wpd.mat.mult2x2Vec(a_mat, [xp, yp]);
            dat_vec[0] = dat_vec[0] + c_vec[0];
            dat_vec[1] = dat_vec[1] + c_vec[1];

            xf = dat_vec[0];
            yf = dat_vec[1];

            // if x-axis is piecewise: project pixel onto X axis and apply segment mapping
            if (isPiecewiseX) {
                var tx = ((xp - x1) * x_axis_dx + (yp - y1) * x_axis_dy) / x_axis_len_sq;
                if (tx <= t2_piecewise_x) {
                    xf = t2_piecewise_x !== 0 ? xmin + (tx / t2_piecewise_x) * (xmid_data - xmin) : xmin;
                } else {
                    var remx = 1 - t2_piecewise_x;
                    xf = remx !== 0 ? xmid_data + ((tx - t2_piecewise_x) / remx) * (xmax - xmid_data) : xmid_data;
                }
            } else if (isLogScaleX === true) {
                xf = isLogScaleXNegative ? -Math.pow(10, xf) : Math.pow(10, xf);
            }

            // if y-axis is piecewise: project pixel onto Y axis and apply segment mapping
            if (isPiecewiseY) {
                var ty = ((xp - x3) * y_axis_dx + (yp - y3) * y_axis_dy) / y_axis_len_sq;
                if (ty <= t2_piecewise) {
                    yf = t2_piecewise !== 0 ? ymin + (ty / t2_piecewise) * (ymid_data - ymin) : ymin;
                } else {
                    var remy = 1 - t2_piecewise;
                    yf = remy !== 0 ? ymid_data + ((ty - t2_piecewise) / remy) * (ymax - ymid_data) : ymid_data;
                }
            } else if (isLogScaleY === true) {
                yf = isLogScaleYNegative ? -Math.pow(10, yf) : Math.pow(10, yf);
            }

            data[0] = xf;
            data[1] = yf;

            return data;
        };

        this.dataToPixel = function(x, y) {
            var xf, yf, dat_vec, rtnPix;

            if (isPiecewiseX) {
                var tx;
                var seg1x = (xmin <= xmid_data) ? (x >= xmin && x <= xmid_data) : (x <= xmin && x >= xmid_data);
                if (seg1x) {
                    tx = t2_piecewise_x !== 0 && xmid_data !== xmin ? t2_piecewise_x * (x - xmin) / (xmid_data - xmin) : 0;
                } else {
                    var remx = 1 - t2_piecewise_x;
                    tx = xmax !== xmid_data && remx !== 0 ? t2_piecewise_x + remx * (x - xmid_data) / (xmax - xmid_data) : t2_piecewise_x;
                }
                x = xmin + tx * (xmax - xmin);
            } else if (isLogScaleX) {
                x = isLogScaleXNegative ? Math.log(-x) / Math.log(10) : Math.log(x) / Math.log(10);
            }
            if (isPiecewiseY) {
                // Inverse piecewise: data_y → parametric t → linear-equivalent y for matrix
                var t;
                var seg1 = (ymin <= ymid_data) ? (y >= ymin && y <= ymid_data) : (y <= ymin && y >= ymid_data);
                if (seg1) {
                    t = t2_piecewise !== 0 && ymid_data !== ymin ? t2_piecewise * (y - ymin) / (ymid_data - ymin) : 0;
                } else {
                    var rem = 1 - t2_piecewise;
                    t = ymax !== ymid_data && rem !== 0 ? t2_piecewise + rem * (y - ymid_data) / (ymax - ymid_data) : t2_piecewise;
                }
                // Convert t to the linear data_y equivalent used by the matrix
                y = ymin + t * (ymax - ymin);
            } else if (isLogScaleY) {
                y = isLogScaleYNegative ? Math.log(-y) / Math.log(10) : Math.log(y) / Math.log(10);
            }

            dat_vec = [x - c_vec[0], y - c_vec[1]];
            rtnPix = wpd.mat.mult2x2Vec(a_inv_mat, dat_vec);

            xf = rtnPix[0];
            yf = rtnPix[1];

            return {
                x: xf,
                y: yf
            };
        };

        this.pixelToLiveString = function(pxi, pyi) {
            var rtnString = '',
                dataVal = this.pixelToData(pxi, pyi);
            if (isXDate) {
                rtnString += wpd.dateConverter.formatDateNumber(dataVal[0], initialFormattingX);
            } else {
                rtnString += dataVal[0].toExponential(4);
            }
            rtnString += ', ';

            if (isYDate) {
                rtnString += wpd.dateConverter.formatDateNumber(dataVal[1], initialFormattingY);
            } else {
                rtnString += dataVal[1].toExponential(4);
            }
            return rtnString;
        };

        this.isDate = function(varIndex) {
            if (varIndex === 0) {
                return isXDate;
            } else {
                return isYDate;
            }
        };

        this.getInitialDateFormat = function(varIndex) {
            if (varIndex === 0) {
                return initialFormattingX;
            } else {
                return initialFormattingY;
            }
        };

        this.isLogX = function() {
            return isLogScaleX;
        };

        this.isLogXNegative = function() {
            return isLogScaleXNegative;
        }

        this.isLogY = function() {
            return isLogScaleY;
        };

        this.isPiecewiseY = function() {
            return isPiecewiseY;
        };

        this.isPiecewiseX = function() {
            return isPiecewiseX;
        };

        this.isLogYNegative = function() {
            return isLogScaleYNegative;
        }

        this.noRotation = function() {
            return noRotation;
        };

        this.getOrientation = function() {
            // Used by histogram auto-extract method only at the moment.
            // Just indicate increasing y-axis at the moment so that we can work with histograms.
            return {
                axes: 'Y',
                direction: 'increasing',
                angle: 90
            };
        };

        this.getMetadata = function() {
            // deep clone
            return JSON.parse(JSON.stringify(metadata));
        };

        this.setMetadata = function(obj) {
            // deep clone
            metadata = JSON.parse(JSON.stringify(obj));
        };

        this.name = "XY";
    };

    AxesObj.prototype.numCalibrationPointsRequired = function() {
        return 4;
    };

    AxesObj.prototype.getDimensions = function() {
        return 2;
    };

    AxesObj.prototype.getAxesLabels = function() {
        return ['X', 'Y'];
    };

    return AxesObj;
})();
