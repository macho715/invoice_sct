"""
Excel Enhanced Utilities Module
고성능 Excel 처리 유틸리티 모듈

기능:
- polars + calamine을 사용한 빠른 Excel 읽기
- xlwings를 사용한 Excel 자동화
- pywin32를 사용한 Windows COM 자동화
- 대용량 데이터 처리 최적화
"""

import os
from pathlib import Path
from typing import Optional, Union, List, Dict, Any
import logging

logger = logging.getLogger(__name__)

# Optional imports with graceful fallback
try:
    import polars as pl
    POLARS_AVAILABLE = True
except ImportError:
    POLARS_AVAILABLE = False
    logger.warning("polars not available. Using pandas fallback.")

try:
    import xlwings as xw
    XLWINGS_AVAILABLE = True
except ImportError:
    XLWINGS_AVAILABLE = False
    logger.warning("xlwings not available. Excel automation disabled.")

try:
    import win32com.client as win32
    PYWIN32_AVAILABLE = True
except ImportError:
    PYWIN32_AVAILABLE = False
    logger.warning("pywin32 not available. Windows COM automation disabled.")

try:
    import pyexcel as pe
    PYEXCEL_AVAILABLE = True
except ImportError:
    PYEXCEL_AVAILABLE = False
    # 경고 메시지를 stderr 대신 logger로만 출력 (PowerShell 에러 방지)
    import logging
    logging.getLogger(__name__).debug("pyexcel not available. Universal Excel interface disabled.")

# Always available
import pandas as pd


# ============================================================================
# Fast Excel Reading (polars + calamine)
# ============================================================================

def read_excel_fast(
    file_path: Union[str, Path],
    sheet_name: Optional[Union[str, int, List[str]]] = None,
    header: Optional[int] = None,
    n_rows: Optional[int] = None,
    engine: str = "calamine",
    fallback_to_pandas: bool = True
) -> pd.DataFrame:
    """
    polars + calamine을 사용한 빠른 Excel 읽기
    
    Args:
        file_path: Excel 파일 경로
        sheet_name: 시트 이름 또는 인덱스 (None이면 첫 번째 시트)
        header: 헤더 행 인덱스 (None이면 자동 감지)
        n_rows: 읽을 행 수 (None이면 전체)
        engine: 엔진 선택 ("calamine" 또는 "openpyxl")
        fallback_to_pandas: polars가 없을 때 pandas로 대체
    
    Returns:
        pandas DataFrame
    """
    file_path = Path(file_path)
    
    if not POLARS_AVAILABLE:
        if fallback_to_pandas:
            logger.info("Using pandas fallback for Excel reading")
            return pd.read_excel(file_path, sheet_name=sheet_name, header=header, nrows=n_rows)
        else:
            raise ImportError("polars is required for fast Excel reading")
    
    try:
        # polars로 읽기 (calamine 엔진 사용)
        # polars read_excel는 pandas와 다른 API를 사용
        # header가 0이 아니면 정확성을 위해 pandas fallback 사용
        if header is not None and header != 0:
            logger.info(f"Header row {header} specified (not 0), using pandas for accurate header detection")
            return pd.read_excel(file_path, sheet_name=sheet_name, header=header, nrows=n_rows)
        
        # header가 None이면 헤더 없이 읽기 (미리보기용)
        # header가 0이면 첫 행을 헤더로 사용
        read_options = {}
        if header is None:
            # 헤더 없이 읽기 (미리보기용) - pandas의 header=None과 동일
            read_options["has_header"] = False
        else:
            # header == 0인 경우 - 첫 행을 헤더로 사용
            read_options["has_header"] = True
        
        # sheet_name 처리
        if sheet_name is None:
            # 첫 번째 시트 읽기
            df_polars = pl.read_excel(file_path, engine=engine, **read_options)
        elif isinstance(sheet_name, str):
            # 특정 시트 읽기
            df_polars = pl.read_excel(file_path, sheet_name=sheet_name, engine=engine, **read_options)
        elif isinstance(sheet_name, int):
            # 시트 인덱스로 읽기
            xl = pd.ExcelFile(file_path)
            sheet_name_str = xl.sheet_names[sheet_name]
            df_polars = pl.read_excel(file_path, sheet_name=sheet_name_str, engine=engine, **read_options)
        else:
            # 여러 시트 읽기 (첫 번째 시트만 반환)
            df_polars = pl.read_excel(file_path, sheet_name=sheet_name[0], engine=engine, **read_options)
        
        # n_rows 제한 적용 (읽은 후 슬라이싱)
        if n_rows is not None and n_rows > 0:
            df_polars = df_polars.head(n_rows)
        
        # pandas로 변환
        df_pandas = df_polars.to_pandas()
        
        # header가 None이면 컬럼명을 숫자로 유지 (미리보기용, pandas의 header=None과 동일)
        # header가 0이면 이미 첫 행이 헤더로 처리됨
        
        # 인덱스 재설정 (안전성)
        df_pandas = df_pandas.reset_index(drop=True)
        
        logger.info(f"Successfully read Excel file using polars+calamine: {file_path.name}")
        return df_pandas
        
    except Exception as e:
        logger.warning(f"polars reading failed: {e}. Falling back to pandas.")
        if fallback_to_pandas:
            return pd.read_excel(file_path, sheet_name=sheet_name, header=header, nrows=n_rows)
        else:
            raise


def read_excel_multisheet_fast(
    file_path: Union[str, Path],
    sheet_names: Optional[List[str]] = None,
    engine: str = "calamine"
) -> Dict[str, pd.DataFrame]:
    """
    여러 시트를 빠르게 읽기
    
    Args:
        file_path: Excel 파일 경로
        sheet_names: 읽을 시트 이름 리스트 (None이면 모든 시트)
        engine: 엔진 선택
    
    Returns:
        {시트명: DataFrame} 딕셔너리
    """
    file_path = Path(file_path)
    
    if not POLARS_AVAILABLE:
        # pandas fallback
        if sheet_names is None:
            return pd.read_excel(file_path, sheet_name=None)
        else:
            return {name: pd.read_excel(file_path, sheet_name=name) for name in sheet_names}
    
    try:
        # ExcelFile로 시트 목록 가져오기
        xl = pd.ExcelFile(file_path)
        target_sheets = sheet_names if sheet_names else xl.sheet_names
        
        result = {}
        for sheet_name in target_sheets:
            try:
                df_polars = pl.read_excel(file_path, sheet_name=sheet_name, engine=engine)
                result[sheet_name] = df_polars.to_pandas()
            except Exception as e:
                logger.warning(f"Failed to read sheet {sheet_name}: {e}")
                # pandas fallback
                result[sheet_name] = pd.read_excel(file_path, sheet_name=sheet_name)
        
        return result
        
    except Exception as e:
        logger.warning(f"polars multisheet reading failed: {e}. Falling back to pandas.")
        if sheet_names is None:
            return pd.read_excel(file_path, sheet_name=None)
        else:
            return {name: pd.read_excel(file_path, sheet_name=name) for name in sheet_names}


# ============================================================================
# Excel Automation (xlwings)
# ============================================================================

def refresh_workbook(workbook_path: Union[str, Path], visible: bool = False) -> bool:
    """
    Excel 워크북 자동 새로고침
    
    Args:
        workbook_path: 워크북 경로
        visible: Excel 창 표시 여부
    
    Returns:
        성공 여부
    """
    if not XLWINGS_AVAILABLE:
        logger.warning("xlwings not available. Cannot refresh workbook.")
        return False
    
    try:
        app = xw.App(visible=visible)
        wb = app.books.open(str(workbook_path))
        wb.api.RefreshAll()  # 모든 연결 새로고침
        wb.save()
        wb.close()
        app.quit()
        logger.info(f"Workbook refreshed: {workbook_path}")
        return True
    except Exception as e:
        logger.error(f"Failed to refresh workbook: {e}")
        return False


def format_workbook_xlwings(
    workbook_path: Union[str, Path],
    sheet_name: Optional[str] = None,
    auto_fit: bool = True,
    bold_header: bool = True,
    visible: bool = False
) -> bool:
    """
    xlwings를 사용한 워크북 서식 적용
    
    Args:
        workbook_path: 워크북 경로
        sheet_name: 시트 이름 (None이면 모든 시트)
        auto_fit: 컬럼 자동 맞춤
        bold_header: 헤더 행 굵게
        visible: Excel 창 표시 여부
    
    Returns:
        성공 여부
    """
    if not XLWINGS_AVAILABLE:
        logger.warning("xlwings not available. Cannot format workbook.")
        return False
    
    try:
        app = xw.App(visible=visible)
        wb = app.books.open(str(workbook_path))
        
        sheets = [wb.sheets[sheet_name]] if sheet_name else wb.sheets
        
        for ws in sheets:
            if bold_header:
                ws.range("1:1").api.Font.Bold = True
            
            if auto_fit:
                ws.api.Columns.AutoFit()
        
        wb.save()
        wb.close()
        app.quit()
        logger.info(f"Workbook formatted: {workbook_path}")
        return True
    except Exception as e:
        logger.error(f"Failed to format workbook: {e}")
        return False


# ============================================================================
# Windows COM Automation (pywin32)
# ============================================================================

def format_workbook_win32(
    workbook_path: Union[str, Path],
    sheet_name: Optional[str] = None,
    auto_fit: bool = True,
    bold_header: bool = True,
    visible: bool = False
) -> bool:
    """
    pywin32를 사용한 워크북 서식 적용
    
    Args:
        workbook_path: 워크북 경로
        sheet_name: 시트 이름 (None이면 모든 시트)
        auto_fit: 컬럼 자동 맞춤
        bold_header: 헤더 행 굵게
        visible: Excel 창 표시 여부
    
    Returns:
        성공 여부
    """
    if not PYWIN32_AVAILABLE:
        logger.warning("pywin32 not available. Cannot format workbook.")
        return False
    
    try:
        excel = win32.Dispatch("Excel.Application")
        excel.Visible = visible
        excel.DisplayAlerts = False
        
        wb = excel.Workbooks.Open(str(workbook_path))
        
        if sheet_name:
            sheets = [wb.Worksheets(sheet_name)]
        else:
            sheets = [wb.Worksheets(i) for i in range(1, wb.Worksheets.Count + 1)]
        
        for ws in sheets:
            if bold_header:
                ws.Range("1:1").Font.Bold = True
            
            if auto_fit:
                ws.Columns.AutoFit()
        
        wb.Save()
        wb.Close()
        excel.Quit()
        
        logger.info(f"Workbook formatted using win32: {workbook_path}")
        return True
    except Exception as e:
        logger.error(f"Failed to format workbook using win32: {e}")
        return False


# ============================================================================
# Universal Excel Interface (pyexcel)
# ============================================================================

def read_excel_universal(
    file_path: Union[str, Path],
    sheet_name: Optional[str] = None
) -> Union[pd.DataFrame, Dict[str, pd.DataFrame]]:
    """
    pyexcel을 사용한 범용 Excel 읽기 (다양한 포맷 지원)
    
    Args:
        file_path: Excel 파일 경로
        sheet_name: 시트 이름 (None이면 모든 시트)
    
    Returns:
        DataFrame 또는 {시트명: DataFrame} 딕셔너리
    """
    if not PYEXCEL_AVAILABLE:
        logger.warning("pyexcel not available. Using pandas fallback.")
        return pd.read_excel(file_path, sheet_name=sheet_name)
    
    try:
        if sheet_name:
            array = pe.get_array(file_name=str(file_path), sheet_name=sheet_name)
            return pd.DataFrame(array[1:], columns=array[0])
        else:
            # 모든 시트 읽기
            sheets = pe.get_book(file_name=str(file_path))
            result = {}
            for sheet in sheets:
                array = sheet.to_array()
                if len(array) > 0:
                    result[sheet.name] = pd.DataFrame(array[1:], columns=array[0])
            return result
    except Exception as e:
        logger.warning(f"pyexcel reading failed: {e}. Using pandas fallback.")
        return pd.read_excel(file_path, sheet_name=sheet_name)


# ============================================================================
# Performance Benchmarking
# ============================================================================

def benchmark_excel_reading(
    file_path: Union[str, Path],
    sheet_name: Optional[str] = None,
    n_rows: Optional[int] = None
) -> Dict[str, float]:
    """
    Excel 읽기 성능 벤치마크
    
    Returns:
        {방법: 소요 시간(초)} 딕셔너리
    """
    import time
    
    file_path = Path(file_path)
    results = {}
    
    # pandas benchmark
    start = time.time()
    try:
        pd.read_excel(file_path, sheet_name=sheet_name, nrows=n_rows)
        results["pandas"] = time.time() - start
    except Exception as e:
        results["pandas"] = None
        logger.warning(f"pandas benchmark failed: {e}")
    
    # polars + calamine benchmark
    if POLARS_AVAILABLE:
        start = time.time()
        try:
            read_excel_fast(file_path, sheet_name=sheet_name, n_rows=n_rows)
            results["polars_calamine"] = time.time() - start
        except Exception as e:
            results["polars_calamine"] = None
            logger.warning(f"polars benchmark failed: {e}")
    
    return results

